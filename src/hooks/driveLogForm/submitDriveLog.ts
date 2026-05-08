/**
 * submitDriveLog — 운행일지 제출/수정 비즈니스 로직
 * useDriveLogForm에서 추출
 */
import { createDriveLog, updateDriveLog, updateReservationStatus, updateHipassCard } from '../../lib/firestore';

import { increment } from 'firebase/firestore';
import { validateDriveLogForm, buildLogData, nowTime, todayStr } from '../utils/driveLogValidation';
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
    isRetroactive: boolean;
    ocrUsed: boolean;
    favoriteUsed: boolean;
    isElectric: boolean;
    isEditMode: boolean;
    editLog: (DriveLog & { passengerNames?: string[] }) | null;
    reservationData: { reservationId?: string } | null;
    hipassCard: HipassCard | null;
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
}

/**
 * 운행일지 유효성 검사
 */
export function validateForm(
    form: DriveLogForm,
    options: { isElectric: boolean; isQuickDrive: boolean },
): { valid: boolean; message?: string | null } {
    return validateDriveLogForm(form, options);
}

/**
 * 운행일지 제출 또는 수정
 */
export async function submitDriveLog(ctx: SubmitContext): Promise<SubmitResult> {
    const {
        form, orgId, user, userData, selectedVehicle,
        selectedPassengers, externalPassengerCount, externalPassengerNames, isRetroactive,
        ocrUsed, favoriteUsed, isEditMode, editLog, reservationData,
        hipassCard,
    } = ctx;

    const logData = buildLogData(form, {
        orgId: orgId || undefined, user, userData, selectedVehicle,
        selectedPassengers, externalPassengerCount, externalPassengerNames,
        isRetroactive, ocrUsed, favoriteUsed,
    });

    // 하이패스 정보를 운행일지에 저장
    if (hipassCard && form.hipassBalanceAfter !== '') {
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
        const result = await updateDriveLog(editLog.id, logData);
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
        } catch (e) {
            console.warn('[submitDriveLog] 예약 상태 업데이트 실패:', e);
            captureError(e, { context: 'submitDriveLog.updateReservationStatus', resId });
            backgroundWarnings.push('예약 상태 변경에 실패했습니다 (새로고침 후에도 "운행 중"일 시 관리자 문의)');
        }
    }

    // 하이패스 잔액 업데이트: 동기적으로 await하여 잔액 불일치(데이터 정합성) 방지
    if (hipassCard && form.hipassBalanceAfter !== '') {
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
    };
}

/** 운행일지 폼 초기값 */
export function getEmptyForm(): DriveLogForm {
    return {
        vehicleId: '', vehicleName: '', purpose: '', destination: '',
        startKm: '', endKm: '', startTime: nowTime(),
        endTime: '', batteryStart: '', batteryEnd: '', notes: '',
        driveDate: todayStr(), hipassBalanceAfter: '',
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
