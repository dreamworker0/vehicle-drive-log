/**
 * submitDriveLog — 운행일지 제출/수정 비즈니스 로직
 * useDriveLogForm에서 추출
 */
import { createDriveLog, updateDriveLog, updateReservationStatus, updateHipassCard } from '../../lib/firestore';
import { enqueueLog } from '../../lib/offlineQueue';
import { validateDriveLogForm, buildLogData, nowTime, todayStr } from '../utils/driveLogValidation';
import type { DriveLogForm } from '../useDriveLogForm';
import type { Vehicle } from '../../types/vehicle';
import type { User as UserDoc } from '../../types/user';
import type { DriveLog } from '../../types/driveLog';
import type { HipassCard } from '../../types/hipass';
import type { User as FirebaseUser } from 'firebase/auth';

interface SubmitContext {
    form: DriveLogForm;
    orgId: string | null | undefined;
    user: FirebaseUser;
    userData: UserDoc | null;
    selectedVehicle: Vehicle | undefined;
    selectedPassengers: UserDoc[];
    externalPassengerCount: number;
    isRetroactive: boolean;
    ocrUsed: boolean;
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
    /** 자동 보정된 startKm 정보 */
    syncResult?: { updated?: boolean; oldStartKm?: number; newStartKm?: number };
    correctedKm?: { oldStartKm?: number; correctedStartKm?: number };
    /** 폼 리셋 필요 여부 */
    shouldResetForm?: boolean;
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
        selectedPassengers, externalPassengerCount, isRetroactive,
        ocrUsed, isEditMode, editLog, reservationData,
        hipassCard,
    } = ctx;

    const logData = buildLogData(form, {
        orgId, user, userData, selectedVehicle,
        selectedPassengers, externalPassengerCount,
        isRetroactive, ocrUsed,
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

    if (isEditMode && editLog) {
        // 오프라인 큐잉
        if (!navigator.onLine) {
            await enqueueLog(logData as Record<string, unknown>, 'update', editLog.id);
            return {
                success: true,
                message: '오프라인에서 수정 저장됨 · 온라인 복귀 시 자동 반영',
                offline: true,
            };
        }
        const result = await updateDriveLog(editLog.id, logData);
        const sr = (result as Record<string, unknown>)?.syncResult as SubmitResult['syncResult'];
        if (sr?.updated) syncResult = sr;
    } else {
        const extendedLogData = { ...logData, reservationId: reservationData?.reservationId || null };

        if (!navigator.onLine) {
            await enqueueLog(extendedLogData as Record<string, unknown>);
            return {
                success: true,
                message: '오프라인에서 저장됨 · 온라인 복귀 시 자동 전송',
                offline: true,
                shouldResetForm: true,
            };
        }

        const result = await createDriveLog(extendedLogData as Parameters<typeof createDriveLog>[0]);
        const sr = (result as Record<string, unknown>)?.syncResult as SubmitResult['syncResult'];
        if (sr?.updated) syncResult = sr;

        const autocorrectedKm = (result as Record<string, unknown>)?.correctedStartKm as number | undefined;
        const origStartKm = (result as Record<string, unknown>)?.oldStartKm as number | undefined;
        if (autocorrectedKm !== undefined) {
            correctedKm = { oldStartKm: origStartKm, correctedStartKm: autocorrectedKm };
        }
    }

    // 예약 상태 업데이트
    if (!isEditMode && reservationData?.reservationId) {
        await updateReservationStatus(reservationData.reservationId, 'completed', {
            actualStartTime: form.startTime || '',
            actualEndTime: form.endTime || nowTime(),
        });
        await clearDrivingNotification(reservationData.reservationId);
    }

    // 하이패스 잔액 업데이트
    if (hipassCard && form.hipassBalanceAfter !== '') {
        await updateHipassCard(hipassCard.id, {
            balance: Number(form.hipassBalanceAfter),
            organizationId: orgId,
        });
    }

    // 결과 결정
    if (isEditMode) {
        return {
            success: true,
            message: '운행일지가 수정되었습니다.',
            shouldNavigate: 'my-records',
            syncResult,
        };
    }

    if (reservationData?.reservationId) {
        return {
            success: true,
            message: '예약 운행일지가 저장되었습니다.',
            shouldNavigate: 'today',
            syncResult,
            correctedKm,
        };
    }

    return {
        success: true,
        shouldResetForm: true,
        syncResult,
        correctedKm,
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
