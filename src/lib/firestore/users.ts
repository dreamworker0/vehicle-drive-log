/**
 * Firestore — 사용자 (Users) 관련 함수
 */
import {
    doc, getDoc, setDoc, updateDoc, deleteDoc,
    collection, query, where, getDocs, getCountFromServer,
    serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { User } from '../../types/user';
import { createZodConverter, userSchema } from '../../schemas';
import { captureError } from '../sentry';
import { actorStamp } from './actorStamp';
import { cachedQuery, invalidateCache } from './cache';

const userConverter = createZodConverter(userSchema);

/**
 * 쓰기가 permission-denied로 거부됐을 때, 대상이 **이미 내 기관에서 빠졌는지** 다시 읽어 확인한다.
 *
 * 본인이 기관을 나가면 users 문서가 지워지거나 소속이 비워진다(organizationId=null). 관리자
 * 화면의 목록은 한 번 읽어 온 스냅샷이라 그 행이 남는데, 문서가 남아 있으면 그 행의 쓰기는
 * not-found가 아니라 permission-denied로 온다 — Rules의 isOrgAdmin(resource.data.organizationId)이
 * 실패하기 때문이다. 콜러블(disableUser·deleteUserPermanently)도 같은 경우 "다른 기관의 직원을
 * …할 수 없습니다"(permission-denied)로 거부한다.
 *
 * 그래서 거부의 원인이 "대상이 빠졌다"인지 문서를 다시 읽어 가린다.
 * - 읽기도 거부되면 빠진 것이다. Rules는 같은 기관 멤버의 문서만 읽게 하므로(미소속 문서는
 *   본인 외 열람 불가) 문서가 없거나·미소속이거나·다른 기관이면 모두 여기로 온다.
 * - 읽혔는데 문서가 없거나 소속이 `orgId`와 다르면 빠진 것이다(superAdmin 등 읽기 권한이 넓은 경우).
 * - 읽혔고 소속이 같으면 진짜 권한 문제다 — 원래 오류를 그대로 돌려준다.
 * - 재확인 자체가 실패하면(네트워크 등) 판단하지 않고 원래 오류를 돌려준다. 재확인 실패는
 *   보고하지 않는다 — 원래 오류가 호출부의 보고 경로로 올라간다.
 *
 * 한계: 관리자 **본인의** 소속 클레임이 바뀐 상태(본인이 기관을 나감)에서도 읽기가 거부되어
 * "대상이 빠졌다"로 판정된다. 그 경우는 본인 문서 구독이 화면을 초대 코드 화면으로 넘기므로
 * 안내 문구가 잘못 뜨는 순간이 짧고, 보고할 결함도 아니다.
 *
 * @param orgId 기대하는 소속. 생략하면 "읽기 거부·문서 없음"만으로 판정한다.
 * @returns 대상이 빠졌으면 code가 'not-found'인 오류(원래 오류는 cause), 아니면 원래 오류.
 *   code를 not-found로 맞추는 이유: 관리자에게는 "문서가 없다"와 "내 기관에 없다"가 구별되지
 *   않으며(Rules상 둘 다 읽기 거부), 화면·보고 경로가 이미 not-found를 낡은 목록 신호로 다룬다.
 */
export const recheckDeniedTarget = async (error: unknown, uid: string, orgId?: string | null): Promise<unknown> => {
    const code = (error as { code?: unknown })?.code;
    if (code !== 'permission-denied' && code !== 'functions/permission-denied') return error;

    let gone: boolean;
    try {
        const snap = await getDoc(doc(db, 'users', uid));
        gone = !snap.exists() || (orgId != null && snap.get('organizationId') !== orgId);
    } catch (readError) {
        if ((readError as { code?: unknown })?.code === 'permission-denied') {
            gone = true;
        } else {
            console.warn('[recheckDeniedTarget] 대상 재확인 실패 — 원래 오류로 처리합니다.', readError);
            return error;
        }
    }
    if (!gone) return error;
    return Object.assign(new Error('대상 사용자가 이미 기관에 없습니다.'), { code: 'not-found', cause: error });
};

/**
 * 갱신 실패를 보고한다 — 단, **대상 문서가 이미 없는 경우(not-found)는 제외**한다.
 *
 * 관리자·슈퍼관리자 화면의 목록은 한 번 읽어 온 스냅샷이라, 그 사이 본인이 기관을 나가거나
 * (소속 비움 — clearUserOrganization) 슈퍼관리자가 멤버를 제거한(문서 삭제 — leaveOrganization)
 * 계정의 행이 남고, 거기서 수정·역할 변경·재활성화를 누르면 not-found가 온다
 * (문서가 남은 경우의 permission-denied는 recheckDeniedTarget이 not-found로 바꿔 온다).
 * **화면이 판단해 안내할 상태이지 코드 결함이 아니다.**
 *
 * 코드가 잘못된 id를 넘긴 경우도 같은 코드로 오지만, 그 실패는 화면에서 매번 재현되고
 * 여기서 삼켜도 콘솔 경고와 호출부의 보고 경로(useRetry의 기본 동작)에 그대로 남는다.
 * 나머지 코드는 예전처럼 전부 보고한다 — 판단이 서지 않는 실패를 조용히 넘기지 않는다.
 */
function reportUnlessMissing(error: unknown, context: Record<string, unknown>) {
    if ((error as { code?: string })?.code === 'not-found') {
        console.warn(`[${context.context}] 대상 문서가 이미 없습니다 — 호출부에서 처리합니다.`, context);
        return;
    }
    captureError(error, context);
}

// 사용자 조회
export const getUser = async (uid: string) => {
    try {
        const snap = await getDoc(doc(db, 'users', uid).withConverter(userConverter));
        return snap.exists() ? snap.data() : null;
    } catch (error) {
        captureError(error, { context: 'getUser', uid });
        throw error;
    }
};

/**
 * 사용자 생성
 *
 * 주의: merge 없는 setDoc이므로 기존 문서에 쓰면 필드가 사라진다. 특히 이용약관
 * 동의 기록(consent)은 Rules가 클라이언트 변경을 차단하므로, 동의 기록이 있는
 * 문서에 이 함수를 쓰면 permission-denied가 난다. 신규 문서 생성 전용으로만 쓴다.
 * (현재 호출자 없음 — 사용자 문서는 joinOrganization/submitOrgApplication이 만든다.)
 */
export const createUser = async (uid: string, data: Partial<User>) => {
    try {
        await setDoc(doc(db, 'users', uid), {
            theme: 'dark',
            ...data,
            createdAt: serverTimestamp(),
        });
    } catch (error) {
        captureError(error, { context: 'createUser', uid, data });
        throw error;
    }
};

// 멤버 제거 (사용자 문서 삭제 → onSnapshot이 감지 → 초대 코드 화면)
// users 삭제는 Rules상 superAdmin 전용이다. 본인이 기관을 나갈 때는 clearUserOrganization을 쓴다.
export const leaveOrganization = async (uid: string) => {
    try {
        await deleteDoc(doc(db, 'users', uid));
        invalidateCache('members');
    } catch (error) {
        captureError(error, { context: 'leaveOrganization', uid });
        throw error;
    }
};

// 사용자 정보 수정
export const updateUser = async (uid: string, data: Partial<User>) => {
    // updateUser의 경우 data의 일부 필드만 수정될 수 있으므로 Converter를 씌우지 않거나, 
    // updateDoc 파라미터로 그대로 사용하되 타입 제한을 Partial<User>로 제한합니다.
    try {
        await updateDoc(doc(db, 'users', uid), { ...data, ...actorStamp() });
        invalidateCache('members');
    } catch (error) {
        const resolved = await recheckDeniedTarget(error, uid);
        reportUnlessMissing(resolved, { context: 'updateUser', uid, data });
        throw resolved;
    }
};

// 기관 소속 직원 목록 조회 (TTL 5분 캐시 — 11곳에서 독립 호출되어 화면 전환마다
// 직원 수만큼 read가 반복되던 것을 병합한다. 클라이언트발 변경은 updateUser 등에서
// invalidateCache('members')로 즉시 무효화되고, 직원 관리 화면은 fetchData가 직접 무효화한다.)
export const getOrganizationMembers = async (orgId: string) => {
    try {
        return await cachedQuery(`members:${orgId}`, async () => {
            const q = query(
                collection(db, 'users').withConverter(userConverter),
                where('organizationId', '==', orgId)
            );
            const snap = await getDocs(q);
            return snap.docs.map(d => d.data());
        }, 300_000);
    } catch (error) {
        captureError(error, { context: 'getOrganizationMembers', orgId });
        throw error;
    }
};

// 기관 소속 관리자 목록 조회 (조직 격리 보호)
export const getOrganizationAdmins = async (orgId: string) => {
    try {
        const q = query(
            collection(db, 'users').withConverter(userConverter),
            where('organizationId', '==', orgId),
            where('role', '==', 'admin')
        );
        const snap = await getDocs(q);
        return snap.docs.map(d => d.data());
    } catch (error) {
        captureError(error, { context: 'getOrganizationAdmins', orgId });
        throw error;
    }
};

// 전체 기관별 유효 멤버 수 조회 (미활성 기관 판별용)
export const getOrgMemberCounts = async (orgIds?: string[]): Promise<Record<string, number>> => {
    try {
        const counts: Record<string, number> = {};
        
        if (!orgIds || orgIds.length === 0) {
            return counts;
        }

        // 기관별로 getCountFromServer 병렬 수행 (개별 문서 읽기 없이 인덱스 스캔만 수행)
        // note: name != '-' 조건은 복합 인덱스 필요 → organizationId 단일 조건으로 조회 후 클라이언트 필터링
        await Promise.all(
            orgIds.map(async (orgId) => {
                const q = query(
                    collection(db, 'users'),
                    where('organizationId', '==', orgId)
                );
                const snap = await getCountFromServer(q);
                counts[orgId] = snap.data().count;
            })
        );
        
        return counts;
    } catch (error) {
        captureError(error, { context: 'getOrgMemberCounts' });
        throw error;
    }
};

// 사용자 계정 활성화 복원
export const restoreUser = async (uid: string): Promise<void> => {
    try {
        await updateDoc(doc(db, 'users', uid), { status: 'active', disabledAt: null, ...actorStamp() });
        invalidateCache('members');
    } catch (error) {
        const resolved = await recheckDeniedTarget(error, uid);
        reportUnlessMissing(resolved, { context: 'restoreUser', uid });
        throw resolved;
    }
};

// 사용자의 기관 정보 초기화 (본인 기관 나가기·기관 이동 준비 — Rules의 본인 탈퇴 update 분기)
export const clearUserOrganization = async (uid: string): Promise<void> => {
    try {
        await updateDoc(doc(db, 'users', uid), {
            organizationId: null,
            role: 'employee',
            ...actorStamp(),
        });
        invalidateCache('members');
    } catch (error) {
        captureError(error, { context: 'clearUserOrganization', uid });
        throw error;
    }
};

// 참고: Google OAuth 토큰은 더 이상 클라이언트에서 다루지 않는다.
// 토큰은 users/{uid}/private/oauth 서브컬렉션(Cloud Functions/Admin SDK 전용)에만 저장되며,
// 과거 클라이언트용 save/get/clear 함수는 같은 기관 멤버 노출 위험 때문에 제거했다 (2026-07-10 감사 #4).
