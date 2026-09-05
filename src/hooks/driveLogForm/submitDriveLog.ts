/**
 * submitDriveLog — 운행일지 제출/수정 비즈니스 로직
 * useDriveLogForm에서 추출
 */
import { createDriveLog, updateDriveLog, updateReservationStatus, updateHipassCard, completeReservationGroupSiblings } from '../../lib/firestore';

import { increment, deleteField } from 'firebase/firestore';
import { buildLogData, nowTime, todayStr } from '../utils/driveLogValidation';
import type { DriveLogForm } from './types';
import type { Vehicle } from '../../types/vehicle';
import type { User as UserDoc } from '../../types/user';
import type { DriveLog } from '../../types/driveLog';
import type { HipassCard } from '../../types/hipass';
import type { User as FirebaseUser } from 'firebase/auth';
import { captureError } from '../../lib/sentry';

interface SubmitContext {
    form: DriveLogForm;
    orgId: string | null | undefined;
    user: FirebaseUser;
    userData: UserDoc | null;
    selectedVehicle: Vehicle | undefined;
    selectedPassengers: UserDoc[];
    externalPassengerCount: number;
    externalPassengerNames: string;
    selectedCoDrivers: UserDoc[];
    externalCoDriverNames: string;
    isRetroactive: boolean;
    ocrUsed: boolean;
    favoriteUsed: boolean;
    isElectric: boolean;
    isEditMode: boolean;
    editLog: (DriveLog & { passengerNames?: string[] }) | null;
    reservationData: { reservationId?: string } | null;
    hipassCard: HipassCard | null;
    isManuallyCorrected?: boolean;
    originalStartKm?: number;
    /** 출발지 이름(분관 등록 기관만). 분관 차량이 어디서 출발했는지 기록에 남긴다. */
    startLocation?: string;
}

interface SubmitResult {
    success: boolean;
    /** 성공 시 toast 메시지 */
    message?: string;
    /** 오프라인 큐잉 여부 */
    offline?: boolean;
    /** 수정 모드: navigate 필요 여부 */
    shouldNavigate?: 'my-records' | 'today' | null;
    /** 서버/트리거에 의해 자동 갱신된 startKm 정보 */
    syncResult?: { updated?: boolean; oldStartKm?: number; newStartKm?: number };
    correctedKm?: { oldStartKm?: number; correctedStartKm?: number };
    /** 폼 리셋 필요 여부 */
    shouldResetForm?: boolean;
    /** km 동기화 실패 경고 */
    backgroundWarning?: string;
    /** 조기 반납으로 함께 취소된 다일 예약 날짜 수 (0이면 알리지 않는다) */
    cancelledReservationDays?: number;
}

/**
 * 운행일지 제출 또는 수정
 */
export async function submitDriveLog(ctx: SubmitContext): Promise<SubmitResult> {
    const {
        form, orgId, user, userData, selectedVehicle,
        selectedPassengers, externalPassengerCount, externalPassengerNames,
        selectedCoDrivers, externalCoDriverNames, isRetroactive,
        ocrUsed, favoriteUsed, isEditMode, editLog, reservationData,
        hipassCard, isManuallyCorrected, originalStartKm, startLocation,
    } = ctx;

    const logData = buildLogData(form, {
        orgId: orgId || undefined, user, userData, selectedVehicle,
        selectedPassengers, externalPassengerCount, externalPassengerNames,
        coDrivers: selectedCoDrivers, externalCoDriverNames,
        isRetroactive, ocrUsed, favoriteUsed, startLocation,
    });

    if (isManuallyCorrected !== undefined) {
        Object.assign(logData, {
            isManuallyCorrected,
            originalStartKm: originalStartKm ?? null,
        });
    }

    // 하이패스 잔액은 **오늘 운행을 오늘 기록할 때만** 다룬다.
    //
    // hipassCard.balance는 지금 카드에 남은 '오늘'의 잔액이다. 그 일지의 날짜가 오늘이
    // 아니면 이 값은 사용 전(before) 기준이 될 수 없다 — 그 사이의 다른 운행이 통째로
    // 무시되어 카드 잔액이 엉뚱한 값으로 바뀐다. 그날 잔액이 오늘보다 많았다면 차감이
    // 아니라 증가가 일어난다(오늘 7,000 / 그날 기록 9,500 → +2,500).
    //
    // 그래서 경계는 '수정이냐'가 아니라 '그 일지가 오늘 것이냐'다. 과거 일지 수정
    // (isEditMode)과 누락 운행 소급 입력(isRetroactive) 양쪽 모두 해당한다. 소급 입력은
    // 새 일지를 쓰는 것이라 isEditMode가 false여서, 수정 모드만 막으면 같은 결함이 남는다.
    // 잔액 정정이 필요하면 하이패스 관리 화면에서 하고, 두 화면에는 입력칸을 띄우지
    // 않는다(VehicleStatusSection의 showHipass).
    const shouldApplyHipass =
        !isEditMode && !isRetroactive && !!hipassCard && form.hipassBalanceAfter !== '';

    // 하이패스 정보를 운행일지에 저장
    if (shouldApplyHipass && hipassCard) {
        Object.assign(logData, {
            hipassCardNumber: hipassCard.cardNumber || '',
            hipassBalanceBefore: hipassCard.balance,
            hipassBalanceAfter: Number(form.hipassBalanceAfter),
        });
    }

    let syncResult: SubmitResult['syncResult'];
    let correctedKm: SubmitResult['correctedKm'];
    const backgroundWarnings: string[] = [];

    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

    if (isEditMode && editLog) {
        // 다일 → 당일로 되돌린 수정에서 startDate를 **명시적으로 지운다.**
        //
        // buildLogData는 같은 날이면 startDate를 undefined로 두는데, updateDriveLog의
        // sanitizeUndefined가 undefined 키를 통째로 걸러 내므로 updateDoc에 아예 실리지 않는다.
        // 그러면 문서에 남은 옛 출발일이 그대로 살아, 다시 열었을 때 사용자의 정정이 사라지고
        // 목록·내보내기에는 없는 날짜가 계속 찍힌다. deleteField()는 sanitizeUndefined가
        // Firebase 특별 객체로 알아보고 통과시킨다.
        const result = await updateDriveLog(editLog.id, {
            ...logData,
            startDate: (logData.startDate ?? deleteField()) as unknown as string | undefined,
            // 같은 이유로 소급 표시도 명시적으로 지운다. 소급으로 적었던 일지를 오늘 도착으로
            // 고쳐도 문서에 isRetroactive가 남으면, 서버 트리거가 그 값을 보고 차량 km·세운
            // 곳·주유 필요 갱신을 계속 건너뛴다 — 화면은 고쳐졌는데 차량 상태만 안 따라온다.
            isRetroactive: (isRetroactive ? true : deleteField()) as unknown as boolean | undefined,
        });
        if (result.syncResult?.updated) syncResult = result.syncResult;
        if (result.backgroundError) {
            backgroundWarnings.push('차량 km 동기화에 실패했습니다');
        }
    } else {
        // 멱등성 보장(Idempotency) 및 중복 생성 방지를 위한 결정론적 해시 ID 생성
        // 동일 차량, 동일 운전자, 동일 날짜, 동일 계기판 입력 시 무조건 같은 ID를 가져 덮어쓰기 됨
        const deterministicId = `${form.vehicleId}_${user.uid}_${form.driveDate.replace(/-/g, '')}_${form.startKm}_${form.endKm}`;
        const generatedId = deterministicId;
        const extendedLogData = {
            ...logData,
            id: generatedId,
            reservationId: reservationData?.reservationId || null
        };


        const result = await createDriveLog(extendedLogData as Parameters<typeof createDriveLog>[0]);
        if (result.syncResult?.updated) syncResult = result.syncResult;

        // 기존의 correctedStartKm 참조 코드 제거 (더 이상 자동 보정하지 않음)

        if (result.backgroundError) {
            backgroundWarnings.push('차량 km 동기화에 실패했습니다');
        }
    }

    /** 조기 반납으로 함께 취소된 다일 예약 날짜 수 — 아래 모든 반환 경로에 실어 보낸다 */
    let cancelledReservationDays = 0;

    // 예약 상태 업데이트: 일지 저장 후 예약을 completed로 전환
    if (!isEditMode && reservationData?.reservationId) {
        const resId = reservationData.reservationId;
        const actualStart = form.startTime || '';
        const actualEnd = form.endTime || nowTime();
        
        try {
            await updateReservationStatus(resId, 'completed', {
                actualStartTime: actualStart,
                actualEndTime: actualEnd,
            });
            await clearDrivingNotification(resId);

            // 1박2일 예약은 문서가 여러 건이다. 운행은 한 번인데 한 건만 닫으면 남은
            // 날짜가 미완료로 떠 미작성 알림이 계속 울린다. 다일이 아니면 아무 일도 없다.
            //
            // 도착일을 함께 넘긴다 — 조기 반납으로 **타지 않은 날**까지 완료로 닫으면
            // 화면에서만 사라지고 차량 점유는 풀리지 않는다.
            //
            // 도착일은 `endDate || driveDate`다. `driveDate`는 **출발일**이고(types.ts),
            // 도착일 칸이 뜨지 않는 예약 흐름에서만 마운트 시각의 오늘로 남아 우연히 같아진다.
            // 그 화면 조건에 기대면, 나중에 예약 흐름에도 날짜 칸이 열리는 순간 **실제로 탄
            // 날이 취소된다.** 저장소의 도착일 관용구(useDriveLogForm·driveWindow·DateSection)와
            // 같은 식을 쓴다.
            if (orgId) {
                const arrivalDate = form.endDate || form.driveDate;
                const group = await completeReservationGroupSiblings(resId, orgId, arrivalDate);
                if (group.closed > 0 || group.cancelled > 0) {
                    console.info(`[submitDriveLog] 다일 예약 정리 — 완료 ${group.closed}일 · 취소 ${group.cancelled}일`);
                }
                // 취소는 사용자가 요청하지 않은 변경이다. 조용히 하면 운행 종료를 잘못 누른
                // 사람은 자기 예약이 사라진 것을 모른 채 다음 날 차를 찾으러 간다.
                cancelledReservationDays = group.cancelled;
                // 오프라인이면 시도조차 못 했고 다시 시도할 기회도 없다(이 예약에 두 번째 저장은
                // 없다). 조용히 넘기면 다일 예약의 남은 날짜가 계속 열려 있게 된다.
                if (group.skippedOffline) {
                    backgroundWarnings.push('연결이 끊겨 예약 정리를 못 했습니다 (여러 날에 걸친 예약이었다면 [차량 예약]에서 남은 날짜를 확인해 주세요)');
                }
            }
        } catch (e) {
            console.warn('[submitDriveLog] 예약 상태 업데이트 실패:', e);
            captureError(e, { context: 'submitDriveLog.updateReservationStatus', resId });
            backgroundWarnings.push('예약 상태 변경에 실패했습니다 (새로고침 후에도 "운행 중"일 시 관리자 문의)');
        }
    }

    // 하이패스 잔액 업데이트: 동기적으로 await하여 잔액 불일치(데이터 정합성) 방지
    if (shouldApplyHipass && hipassCard) {
        const hipassId = hipassCard.id;
        const balAfter = Number(form.hipassBalanceAfter);
        const usedAmount = hipassCard.balance - balAfter;
        const org = orgId ? orgId : undefined;
        
        try {
            await updateHipassCard(hipassId, {
                balance: increment(-usedAmount),
                organizationId: org,
            });
        } catch (e) {
            console.warn('[submitDriveLog] 하이패스 잔액 업데이트 실패:', e);
            captureError(e, { context: 'submitDriveLog.updateHipassCard', hipassId, balAfter, usedAmount, org });
            backgroundWarnings.push('하이패스 잔액 동기화에 실패했습니다');
        }
    }

    const finalBackgroundWarning = backgroundWarnings.length > 0
        ? '운행일지는 저장되었으나 일부 동기화에 실패했습니다: ' + backgroundWarnings.join(', ') + '. 관리자에게 문의해주세요.'
        : undefined;

    // 결과 결정
    if (isEditMode) {
        return {
            success: true,
            message: isOffline ? '오프라인 상태입니다. 수정 사항이 기기에 저장되었으며 통신 재개 시 자동 반영됩니다.' : '운행일지가 수정되었습니다.',
            shouldNavigate: 'my-records',
            offline: isOffline,
            syncResult,
            backgroundWarning: finalBackgroundWarning,
            cancelledReservationDays,
        };
    }

    if (reservationData?.reservationId) {
        return {
            success: true,
            message: isOffline ? '오프라인 상태입니다. 예약 운행일지가 기기에 저장되었으며 통신 재개 시 자동 반영됩니다.' : '예약 운행일지가 저장되었습니다.',
            shouldNavigate: 'today',
            offline: isOffline,
            syncResult,
            correctedKm,
            backgroundWarning: finalBackgroundWarning,
            cancelledReservationDays,
        };
    }

    return {
        success: true,
        message: isOffline ? '오프라인 상태입니다. 운행일지가 기기에 저장되었으며 통신 재개 시 자동 반영됩니다.' : undefined,
        offline: isOffline,
        shouldResetForm: true,
        syncResult,
        correctedKm,
        backgroundWarning: finalBackgroundWarning,
        cancelledReservationDays,
    };
}

/** 운행일지 폼 초기값. driverUid/driverName은 리셋 후 호출부에서 작성자 본인으로 재주입한다. */
export function getEmptyForm(): DriveLogForm {
    return {
        vehicleId: '', vehicleName: '', driverUid: '', driverName: '',
        purpose: '', destination: '',
        startKm: '', endKm: '', startTime: nowTime(),
        endTime: '', batteryStart: '', batteryEnd: '', notes: '',
        driveDate: todayStr(), endDate: '', hipassBalanceAfter: '', needsRefuel: false,
    };
}

/** 서비스 워커 알림 해제 */
async function clearDrivingNotification(resId?: string) {
    if (!resId || !('Notification' in window)) return;
    try {
        const reg = await navigator.serviceWorker?.ready;
        if (!reg) return;
        const notifications = await reg.getNotifications({ tag: `driving-${resId}` });
        notifications.forEach(n => n.close());
    } catch {
        // 무시
    }
}
