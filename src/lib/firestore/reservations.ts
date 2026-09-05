/**
 * Firestore — 차량 예약 (Reservations) 관련 함수
 */
import {
    doc, getDoc, updateDoc, deleteField,
    collection, query, where, getDocs, addDoc,
    serverTimestamp, runTransaction, writeBatch, Timestamp,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, firebaseFunctions, auth } from '../firebase';
import { createZodConverter, reservationSchema } from '../../schemas';
import type { Reservation } from '../../types/reservation';
import { captureError } from '../sentry';
import { enqueue } from '../offline/syncQueue';

const functions = firebaseFunctions;

/**
 * 예약 상태 변경 시 두 관리자가 동시에 처리하려다 충돌한 경우.
 * 예측 가능한 사용자 충돌이므로 Sentry error 보고 대상에서 제외한다(UI는 토스트로 안내).
 */
export class ReservationConcurrencyError extends Error {
    constructor(currentStatus: string) {
        super(`동시성 오류: 이미 다른 관리자에 의해 상태가 변경되었습니다. (현재 상태: ${currentStatus})`);
        this.name = 'ReservationConcurrencyError';
    }
}

const reservationsCollection = () => collection(db, 'reservations').withConverter(createZodConverter(reservationSchema));
const reservationDoc = (id: string) => doc(db, 'reservations', id).withConverter(createZodConverter(reservationSchema));

// 예약 ID로 단일 조회
export const getReservationById = async (reservationId: string) => {
    try {
        const snap = await getDoc(reservationDoc(reservationId));
        if (!snap.exists()) return null;
        return snap.data() as Reservation;
    } catch (error) {
        captureError(error, { context: 'getReservationById', reservationId });
        throw error;
    }
};

// 예약 ID 및 조직 ID로 단일 조회 (조직 격리 보호)
export const getReservationByIdAndOrg = async (reservationId: string, orgId: string) => {
    try {
        const snap = await getDoc(reservationDoc(reservationId));
        if (!snap.exists()) return null;
        const data = snap.data() as Reservation;
        if (data.organizationId !== orgId) {
            console.warn(`[Security Warning] Unauthorized access attempt to reservation ${reservationId} from organization ${orgId}`);
            return null;
        }
        return data;
    } catch (error) {
        captureError(error, { context: 'getReservationByIdAndOrg', reservationId, orgId });
        throw error;
    }
};

// 예약 생성 (클라이언트 측)
export const createReservation = async (data: Partial<Reservation>, requireApproval: boolean = false) => {
    try {
        // zod 스키마로 런타임 값 검증 (실패 시 ZodError throw)
        reservationSchema.parse(data);

        const expiresAt = new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000); // TTL: 5 years
        const docRef = await addDoc(reservationsCollection(), {
            ...data,
            status: requireApproval ? 'pending' : 'reserved',
            createdAt: serverTimestamp(),
            expiresAt,
        } as Record<string, unknown>);
        return docRef.id;
    } catch (error) {
        captureError(error, { context: 'createReservation', data, requireApproval });
        throw error;
    }
};

/** 서버 측 중복 검증 기반 예약 생성 (Cloud Function + Firestore Transaction) */
export const createReservationSafe = async (data: Partial<Reservation>) => {
    try {
        // 모바일 백그라운드 복귀 시 Firebase 토큰 만료에 따른 Unauthenticated 에러 방지
        if (auth.currentUser) {
            await auth.currentUser.getIdToken();
        }

        const callable = httpsCallable(functions, 'createReservationSafe', { timeout: 60000 });
        const result = await callable(data);
        return (result.data as { reservationId: string }).reservationId;
    } catch (error: unknown) {
        // 중복 예약 및 유효성 검사 등 기대되는 비즈니스 로직 에러는 Sentry에 보고하지 않음
        const err = error as { code?: string };
        if (err?.code !== 'functions/already-exists' && err?.code !== 'functions/invalid-argument' && err?.code !== 'functions/permission-denied') {
            captureError(error, { context: 'createReservationSafe', data });
        }
        throw error;
    }
};

// 날짜별 예약 목록 조회
export const getReservations = async (orgId: string, date?: string) => {
    try {
        const constraints = [
            where('organizationId', '==', orgId),
        ];
        if (date) {
            constraints.push(where('date', '==', date));
        } else {
            // date 미지정 시 최근 1개월로 제한 (Firestore 읽기 비용 절감)
            const oneMonthAgo = new Date();
            oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
            constraints.push(where('date', '>=', oneMonthAgo.toISOString().slice(0, 10)));
        }
        const q = query(reservationsCollection(), ...constraints);
        const snap = await getDocs(q);
        return snap.docs.map(d => d.data() as Reservation);
    } catch (error) {
        captureError(error, { context: 'getReservations', orgId, date });
        throw error;
    }
};

// 승인 대기 중인 예약 일회성 조회 (getDocs 기반)
export const getPendingReservations = async (orgId: string) => {
    const q = query(
        reservationsCollection(),
        where('organizationId', '==', orgId),
        where('status', '==', 'pending')
    );
    const snap = await getDocs(q);
    const reservations = snap.docs.map(d => d.data() as Reservation);
    
    // 생성일 순으로 정렬 (가장 오래된 것이 위로 오게)
    reservations.sort((a, b) => {
        const timeA = typeof (a.createdAt as Timestamp)?.toMillis === 'function' ? (a.createdAt as Timestamp).toMillis() : 0;
        const timeB = typeof (b.createdAt as Timestamp)?.toMillis === 'function' ? (b.createdAt as Timestamp).toMillis() : 0;
        return timeA - timeB; // 오름차순
    });
    return reservations;
};

// 예약 취소
export const cancelReservation = async (reservationId: string) => {
    try {
        await updateDoc(reservationDoc(reservationId), {
            status: 'cancelled',
        });
    } catch (error) {
        captureError(error, { context: 'cancelReservation', reservationId });
        throw error;
    }
};

/**
 * 예약 정보 수정
 *
 * `undefined` 필드는 보내지 않는다. Firestore updateDoc은 undefined를 거부하고
 * "Unsupported field value: undefined (found in field …)"로 **저장 전체를 실패**시킨다.
 * 호출부가 폼 상태를 통째로 넘기는 구조라(선택하지 않은 반복 설정 등이 undefined로 남는다)
 * 값 하나 때문에 수정이 막히는 일이 실제로 있었다.
 * 필드를 지우려면 undefined가 아니라 deleteField()를 명시적으로 넘긴다.
 */
export const updateReservation = async (reservationId: string, data: Partial<Reservation>) => {
    try {
        const defined = Object.fromEntries(
            Object.entries(data).filter(([, value]) => value !== undefined)
        );
        await updateDoc(reservationDoc(reservationId), defined);
    } catch (error) {
        captureError(error, { context: 'updateReservation', reservationId, data });
        throw error;
    }
};

/**
 * 반복 그룹에서 한 건을 떼어낸다 (반복 → 단건 전환, 반복 → 다일 전환의 첫날).
 *
 * 그룹 링크(`recurringGroupId`)를 문서에서 **제거**한다. 남겨 두면 이 예약을 다시 열 때
 * 1일짜리 반복 그룹으로 해석돼 단건이 된 것이 아니게 된다. 값을 undefined로 덮는 것은
 * Firestore가 거부하므로 `deleteField()`를 쓴다.
 *
 * 다일 전환에서는 `data.groupId`로 새 다일 그룹을 함께 지정한다 — 반복 링크는 끊고
 * 연속 예약 그룹에 붙이는 것이 한 번의 update로 끝난다.
 *
 * 새로 만들지 않고 기존 문서를 고치는 이유가 둘 있다.
 *  (1) **삭제 권한** — Rules의 예약 delete는 소유자 본인(또는 superAdmin)만 허용한다.
 *      새로 만들려면 그룹을 지워야 하는데, 그러면 기관 관리자가 직원의 반복 예약을
 *      단건으로 바꿀 수 없다. update만 쓰면 관리자 경로도 그대로 동작한다.
 *  (2) **명의 보존** — createReservationSafe는 reservedByUid를 호출자로 강제한다.
 *      다시 만드는 방식은 관리자가 전환할 때 직원의 예약이 관리자 명의로 넘어간다.
 */
export const detachFromRecurringGroup = async (reservationId: string, data: Partial<Reservation>) => {
    try {
        const defined = Object.fromEntries(
            Object.entries(data).filter(([, value]) => value !== undefined)
        );
        await updateDoc(reservationDoc(reservationId), { ...defined, recurringGroupId: deleteField() });
    } catch (error) {
        captureError(error, { context: 'detachFromRecurringGroup', reservationId, data });
        throw error;
    }
};

// 예약 상태 변경 (온라인 트랜잭션 또는 오프라인 큐 낙관적 업데이트)
export const updateReservationStatus = async (
    reservationId: string, 
    status: string, 
    extraData: Partial<Reservation> = {},
    expectedCurrentStatus?: string
) => {
    try {
        const reservationRef = reservationDoc(reservationId);
        
        // 운행 종료 등 사용자가 직접 업데이트하는 경우, 오프라인 큐 및 즉각적인 UI 반영(낙관적 업데이트)을 위해 일반 updateDoc 사용.
        // expectedCurrentStatus가 들어오는 경우(관리자 승인 등)만 동시성 방어를 위해 트랜잭션(온라인 한정) 사용.
        if (!expectedCurrentStatus) {
            const promise = updateDoc(reservationRef, {
                status,
                ...extraData,
            });
            const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
            if (!isOffline) {
                await promise;
            } else {
                promise.catch(e => console.error('[Firestore Offline Sync Error]', e));
                await enqueue('UPDATE', 'reservations', reservationId, { status, ...extraData });
                if (typeof window !== 'undefined' && 'serviceWorker' in navigator && 'SyncManager' in window) {
                    navigator.serviceWorker.ready.then(reg => {
                        const syncReg = reg as ServiceWorkerRegistration & { sync?: { register: (tag: string) => Promise<void> } };
                        if (syncReg.sync) syncReg.sync.register('sync-db');
                    });
                }
            }
            return;
        }

        await runTransaction(db, async (transaction) => {
            const sfDoc = await transaction.get(reservationRef);
            if (!sfDoc.exists()) {
                throw new Error("예약 정보가 존재하지 않습니다.");
            }
            
            const currentData = sfDoc.data();
            if (expectedCurrentStatus && currentData.status !== expectedCurrentStatus) {
                throw new ReservationConcurrencyError(currentData.status);
            }
            
            transaction.update(reservationRef, {
                status,
                ...extraData,
            });
        });
    } catch (error) {
        // 예측 가능한 동시 편집 충돌은 노이즈이므로 Sentry 보고에서 제외(UI는 토스트로 안내).
        if (!(error instanceof ReservationConcurrencyError)) {
            captureError(error, { context: 'updateReservationStatus', reservationId, status, extraData, expectedCurrentStatus });
        }
        throw error;
    }
};

/**
 * 예약 반려 — 사유와 반려 시각(serverTimestamp) 기록을 도메인 계층에서 캡슐화한다.
 * pending 상태 검증 트랜잭션 경로를 사용하므로, 이미 처리된 예약이면
 * ReservationConcurrencyError('동시성 오류')가 발생한다.
 */
export const rejectReservation = async (reservationId: string, reason: string) => {
    return updateReservationStatus(reservationId, 'rejected', {
        rejectedReason: reason,
        rejectedAt: serverTimestamp(),
    } as Partial<Reservation>, 'pending');
};

// 오늘 예약 조회 (취소 제외)
export const getTodayReservations = async (orgId: string, date: string) => {
    try {
        const q = query(
            reservationsCollection(),
            where('organizationId', '==', orgId),
            where('date', '==', date),
        );
        const snap = await getDocs(q);
        return snap.docs
            .map(d => d.data() as Reservation)
            .filter(r => r.status !== 'cancelled');
    } catch (error) {
        captureError(error, { context: 'getTodayReservations', orgId, date });
        throw error;
    }
};

// 주간 예약 조회 (취소 제외)
export const getWeekReservations = async (orgId: string, startDate: string, endDate: string) => {
    try {
        const q = query(
            reservationsCollection(),
            where('organizationId', '==', orgId),
            where('date', '>=', startDate),
            where('date', '<=', endDate),
        );
        const snap = await getDocs(q);
        return snap.docs
            .map(d => d.data() as Reservation)
            .filter(r => r.status !== 'cancelled');
    } catch (error) {
        captureError(error, { context: 'getWeekReservations', orgId, startDate, endDate });
        throw error;
    }
};

// 날짜 범위별 예약 조회 (getWeekReservations 별칭)
export const getReservationsByDateRange = getWeekReservations;

// groupId로 연속 예약 그룹 조회
// Firestore Rules가 organizationId 기반 접근 제어를 하므로 orgId 필터 필수
export const getReservationsByGroupId = async (groupId: string, orgId: string) => {
    try {
        const q = query(
            reservationsCollection(),
            where('organizationId', '==', orgId),
            where('groupId', '==', groupId),
        );
        const snap = await getDocs(q);
        return snap.docs
            .map(d => d.data() as Reservation)
            .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    } catch (error) {
        captureError(error, { context: 'getReservationsByGroupId', groupId, orgId });
        throw error;
    }
};

// ─── 그룹 일괄 액션 헬퍼 ───

/** 그룹 배치 결과 */
interface GroupActionResult {
    /** 실제로 쓴 문서 수 (액션 종류와 무관) */
    total: number;
    /**
     * 그중 **취소로 닫은** 수.
     *
     * complete 액션에서 "타지 않은 날"을 세는 값이다. cancel·delete 액션은 문서를
     * 몇 건 취소·삭제하든 여기가 늘 0이다 — 그 둘은 `total`이 곧 처리 건수다.
     */
    cancelled: number;
}

/**
 * 그룹 내 활성 예약을 조회하여 일괄 batch 액션(update/delete)을 실행하는 공용 헬퍼
 * @param exceptId 이 예약은 건드리지 않는다 (반복 → 단건 전환에서 남길 회차)
 */
const batchGroupAction = async (
    fetchFn: (id: string, orgId: string) => Promise<Reservation[]>,
    action: 'cancel' | 'delete' | 'complete',
    id: string,
    orgId: string,
    context: string,
    exceptId?: string,
    /** complete 전용 — 운행일지의 **도착일**. 이보다 뒤인 날짜는 타지 않은 날이다. */
    arrivalDate?: string,
): Promise<GroupActionResult> => {
    try {
        const reservations = await fetchFn(id, orgId);
        const active = reservations.filter(r =>
            r.status !== 'cancelled' && r.status !== 'completed' && r.id !== exceptId
        );
        const batch = writeBatch(db);
        let cancelled = 0;
        active.forEach(r => {
            if (action === 'cancel') {
                batch.update(reservationDoc(r.id), { status: 'cancelled' });
            } else if (action === 'complete') {
                // 도착일보다 **뒤인 날짜는 아예 타지 않은 날**이라 완료가 아니라 취소다.
                //
                // 9/1~9/3 예약을 9/1 저녁에 조기 반납하면 9/2·9/3은 실제로 운행되지 않았다.
                // 이것을 completed로 닫으면 세 가지가 한꺼번에 어긋난다 —
                //  (1) 화면에서는 사라진다(대시보드가 completed를 거른다),
                //  (2) 그런데 **차량 점유는 그대로다**. 겹침 검사는 completed를
                //      `actualStartTime`이 있을 때만 실제 시각으로 접는데 여기엔 없어서
                //      00:00~23:59 전체를 계속 막는다. 본인 겹침 검사도 같은 규칙이라
                //      그 사람은 남은 기간에 **어떤 차량도** 예약하지 못한다,
                //  (3) 취소도 안 된다. 아래 active 필터가 completed를 제외하므로 쓰기가 0건이다.
                // 즉 보이지도, 풀리지도 않는 예약이 남아 관리자 개입 없이는 복구되지 않는다.
                // cancelled로 보내면 겹침 검사가 곧바로 제외하므로 차량이 즉시 풀린다.
                if (arrivalDate && r.date > arrivalDate) {
                    batch.update(reservationDoc(r.id), { status: 'cancelled' });
                    cancelled++;
                    return;
                }
                // driveLogReminderSent를 함께 심는다 — 이게 없으면 알림을 없애는 게 아니라 **만든다.**
                //
                // reservationReminder의 "운행일지 미작성" 알림은 `status in [completed, in_progress]`인
                // 예약 중 자기 id를 가리키는 driveLog가 없는 건을 찾는다. 다일 예약의 나머지 날짜를
                // completed로 바꾸면 그 조건에 **새로** 걸린다 — 운행일지의 reservationId는 실제로
                // 출발한 날의 문서를 가리키기 때문이다. 상태만 닫으면 조용하던 예약이 울기 시작한다.
                // (cancelled는 두 알림 쿼리 어디에도 걸리지 않아 이 표시가 필요 없다.)
                batch.update(reservationDoc(r.id), { status: 'completed', driveLogReminderSent: true });
            } else {
                batch.delete(reservationDoc(r.id));
            }
        });
        await batch.commit();
        return { total: active.length, cancelled };
    } catch (error) {
        captureError(error, { context, id, orgId });
        throw error;
    }
};

/**
 * 다일 그룹 닫기 결과.
 *
 * 예전에는 건수 하나에 `SKIPPED_OFFLINE = -1` 센티널을 섞어 돌려줬다. 이제 취소한 날 수까지
 * 알려야 해서(사용자에게 "타지 않은 N일을 취소했다"고 말해야 한다) 숫자 하나로는 부족하고,
 * 음수 센티널은 호출부가 `> 0`으로 거르면 조용히 사라지는 종류의 값이라 필드로 갈랐다.
 */
export interface GroupCloseResult {
    /** 완료로 닫은 날 수 (실제로 탄 날) */
    closed: number;
    /** 타지 않아 취소한 날 수 (조기 반납) */
    cancelled: number;
    /** 오프라인이라 시도조차 못 했다 — 0건 처리와 구분해야 안내를 띄울 수 있다 */
    skippedOffline: boolean;
}

// 연속 예약 그룹 일괄 취소
export const cancelReservationGroup = async (groupId: string, orgId: string) =>
    (await batchGroupAction(getReservationsByGroupId, 'cancel', groupId, orgId, 'cancelReservationGroup')).total;

/**
 * 예약 하나를 완료 처리한 뒤, 같은 **다일 그룹의 나머지 날짜**도 함께 닫는다.
 *
 * 1박2일 예약은 문서 두 건이다(9/1 17:00~23:59 · 9/2 00:00~10:00). 실제 운행은 한 번인데
 * 운행일지는 그중 한 건만 완료 처리하므로, 남은 날짜가 미완료로 떠 **운행일지 미작성
 * 알림이 계속 울린다.**
 *
 * `groupId`를 화면 이동 상태로 실어 나르지 않고 여기서 예약 문서를 한 번 읽어 판정한다 —
 * 진입점마다 상태를 꿰면 한 곳을 빠뜨렸을 때 조용히 동작하지 않는다. 다일 예약이 아니면
 * 읽기 한 번으로 끝나고 아무것도 쓰지 않는다.
 *
 * **도착일보다 뒤인 날짜는 완료가 아니라 취소다.** 조기 반납하면 남은 날은 실제로 타지
 * 않았고, 완료로 닫으면 화면에서만 사라진 채 차량 점유가 풀리지 않는다(batchGroupAction 주석).
 *
 * @param arrivalDate 운행일지의 도착일(YYYY-MM-DD). 생략하면 예전처럼 전부 완료 처리한다.
 */
export const completeReservationGroupSiblings = async (
    reservationId: string,
    orgId: string,
    arrivalDate?: string,
): Promise<GroupCloseResult> => {
    // 오프라인에서 붙잡히는 것은 batch.commit()뿐이다 — 서버 확인을 기다리므로 **영영 resolve되지
    // 않고**, 호출부의 runWithRetry 타임아웃까지 저장 완료를 붙잡아 둔다. getDoc은 캐시로
    // 떨어지거나 즉시 거절되지 매달리지 않으므로, 다일 예약인지까지는 알아보고 판단한다.
    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    try {
        const snap = await getDoc(reservationDoc(reservationId));
        const groupId = snap.exists() ? (snap.data() as Reservation).groupId : undefined;
        if (!groupId) return { closed: 0, cancelled: 0, skippedOffline: false };
        // **재시도는 없다.** 이 함수를 부르는 곳은 운행일지 신규 저장 한 군데뿐이고, 그 예약에
        // 두 번째 저장은 일어나지 않는다. 다일인 것이 확인됐을 때만 알린다 — 단건 예약까지
        // 경고하면 "자동 반영됩니다" 안내와 나란히 떠 서로 말이 어긋난다.
        if (isOffline) return { closed: 0, cancelled: 0, skippedOffline: true };
        // 방금 완료한 건은 제외한다 — 이미 completed라 어차피 active 필터에 걸리지 않지만,
        // 반영 지연으로 남아 있어도 두 번 쓰지 않도록 명시한다.
        const { total, cancelled } = await batchGroupAction(
            getReservationsByGroupId, 'complete', groupId, orgId, 'completeReservationGroupSiblings', reservationId,
            arrivalDate,
        );
        return { closed: total - cancelled, cancelled, skippedOffline: false };
    } catch (error) {
        // 오프라인이면 캐시에 예약이 없었을 뿐이다. 다일인지 알 수 없으니 조용히 넘긴다 —
        // 알 수 없는 것을 경고로 바꾸면 단건 예약 저장마다 헛경고가 뜬다.
        if (isOffline) return { closed: 0, cancelled: 0, skippedOffline: false };
        captureError(error, { context: 'completeReservationGroupSiblings', reservationId, orgId });
        throw error;
    }
};

// 연속 예약 그룹 삭제 (수정 전 기존 그룹 제거용)
export const deleteReservationGroup = async (groupId: string, orgId: string) =>
    (await batchGroupAction(getReservationsByGroupId, 'delete', groupId, orgId, 'deleteReservationGroup')).total;

// 내 최근 예약 조회 (취소 제외, 최신 순 정렬하여 반환)
// 복합 인덱스: organizationId + reservedByUid + date (firestore.indexes.json)
// orderBy 없이 클라이언트 메모리에서 정렬 처리
export const getMyRecentReservations = async (orgId: string, uid: string, limitCount = 50) => {
    try {
        // 최근 3개월치만 조회하여 Firestore 읽기 비용 절감
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        const sinceStr = threeMonthsAgo.toISOString().slice(0, 10);
        const q = query(
            reservationsCollection(),
            where('organizationId', '==', orgId),
            where('reservedByUid', '==', uid),
            where('date', '>=', sinceStr),
        );
        const snap = await getDocs(q);
        return snap.docs
            .map(d => d.data() as Reservation)
            .filter(r => r.status !== 'cancelled')
            .sort((a, b) => ((b.date || '') + (b.startTime || '')).localeCompare((a.date || '') + (a.startTime || '')))
            .slice(0, limitCount);
    } catch (error) {
        captureError(error, { context: 'getMyRecentReservations', orgId, uid });
        throw error;
    }
};

// ─── 반복(정기) 예약 그룹 관련 ───

// recurringGroupId로 반복 예약 그룹 조회
export const getReservationsByRecurringGroupId = async (recurringGroupId: string, orgId: string) => {
    try {
        const q = query(
            reservationsCollection(),
            where('organizationId', '==', orgId),
            where('recurringGroupId', '==', recurringGroupId),
        );
        const snap = await getDocs(q);
        return snap.docs
            .map(d => d.data() as Reservation)
            .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    } catch (error) {
        captureError(error, { context: 'getReservationsByRecurringGroupId', recurringGroupId, orgId });
        throw error;
    }
};

/**
 * 반복 예약 그룹 일괄 취소
 * @param exceptId 남길 회차 (반복 → 단건 전환에서 단건으로 살아남는 예약)
 */
export const cancelRecurringGroup = (recurringGroupId: string, orgId: string, exceptId?: string) =>
    batchGroupAction(getReservationsByRecurringGroupId, 'cancel', recurringGroupId, orgId, 'cancelRecurringGroup', exceptId)
        .then(r => r.total);

// 반복 예약 그룹 삭제 (수정 전 기존 그룹 제거용)
export const deleteRecurringGroup = async (recurringGroupId: string, orgId: string) =>
    (await batchGroupAction(getReservationsByRecurringGroupId, 'delete', recurringGroupId, orgId, 'deleteRecurringGroup')).total;

