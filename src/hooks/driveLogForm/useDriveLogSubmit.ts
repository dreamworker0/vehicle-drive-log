/**
 * driveLogForm/useDriveLogSubmit.ts
 * 운행일지 폼의 제출 및 사용자 입력 핸들러 모음
 */
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createFavorite, getFavorites, getLastVehicleDriveLog } from '../../lib/firestore';
import { resolveStartKm } from './resolveStartKm';
import { invalidateDashboardCache } from '../useTodayDashboard';
import { submitDriveLog, getEmptyForm } from './submitDriveLog';
import { validateDriveLogForm } from '../utils/driveLogValidation';
import { validateEditKmRange } from './editKmRange';
import { adjustAdjacentLogs } from './adjustAdjacentLogs';
import { captureError } from '../../lib/sentry';
import type { User } from 'firebase/auth';
import type { User as UserDoc } from '../../types/user';
import type { Favorite } from '../../types/favorite';
import type { Vehicle } from '../../types/vehicle';
import type { DriveLogForm, LocationState } from './types';
import type { HipassCard } from '../../types/hipass';
import type { DriveLog } from '../../types/driveLog';

export interface SubmitDeps {
    // State & Form
    form: DriveLogForm;
    setForm: React.Dispatch<React.SetStateAction<DriveLogForm>>;
    orgId: string | null | undefined;
    user: User | null;
    userData: UserDoc | null; // 구체적인 타입이 필요할 수 있음
    vehicles: Vehicle[];
    selectedVehicle: Vehicle | undefined;
    selectedPassengers: UserDoc[];
    setSelectedPassengers: React.Dispatch<React.SetStateAction<UserDoc[]>>;
    externalPassengerCount: number;
    setExternalPassengerCount: (v: number) => void;
    externalPassengerNames: string;
    selectedCoDrivers: UserDoc[];
    setSelectedCoDrivers: React.Dispatch<React.SetStateAction<UserDoc[]>>;
    externalCoDriverNames: string;
    setExternalCoDriverNames: (v: string) => void;
    setFavorites: React.Dispatch<React.SetStateAction<Favorite[]>>;
    setShowFavSave: (v: boolean) => void;
    setFavName: (v: string) => void;
    setSuccess: (v: boolean) => void;
    
    // Flags
    isElectric: boolean;
    isRetroactive: boolean;
    isEditMode: boolean;
    editLog: DriveLog | null;
    reservationData: LocationState | null;
    hipassCard: HipassCard | null;
    favName: string;
    lastDriveLog: DriveLog | null;
    nextDriveLog: DriveLog | null;
    setLastDriveLog: React.Dispatch<React.SetStateAction<DriveLog | null>>;
    
    // Helpers
    showToast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
    runWithRetry: <T>(
        key: string,
        asyncFn: () => Promise<T>,
        opts?: {
            errorMessage?: string;
            onError?: (err: unknown) => boolean | void;
            timeoutMs?: number;
            useBackoff?: boolean;
            baseDelayMs?: number;
        }
    ) => Promise<T | undefined>;
    startTransition: (scope: () => Promise<void>) => void;
    ocrSuccess: boolean;
}

export function useDriveLogSubmit(deps: SubmitDeps) {
    const navigate = useNavigate();
    const {
        form, setForm, orgId, user, userData, vehicles, selectedVehicle,
        selectedPassengers, setSelectedPassengers, externalPassengerCount, setExternalPassengerCount,
        externalPassengerNames,
        selectedCoDrivers, setSelectedCoDrivers, externalCoDriverNames, setExternalCoDriverNames,
        setFavorites, setShowFavSave, setFavName, setSuccess,
        isElectric, isRetroactive, isEditMode, editLog, reservationData, hipassCard, favName,
        lastDriveLog, nextDriveLog, setLastDriveLog,
        showToast, runWithRetry, startTransition, ocrSuccess
    } = deps;

    const [confirmStartKm, setConfirmStartKm] = useState<{ original: number, suggested: number } | null>(null);
    const [kmRangeError, setKmRangeError] = useState<string | null>(null);

    const handleVehicleSelect = useCallback(async (vehicleId: string) => {
        const v = vehicles.find(veh => veh.id === vehicleId);
        const [km, lastLog] = await Promise.all([
            resolveStartKm(orgId!, vehicleId, {
                driveDate: form.driveDate,
                startTime: form.startTime,
                vehicle: v || null,
            }),
            getLastVehicleDriveLog(orgId!, vehicleId, isEditMode && editLog ? editLog.id : undefined)
        ]);
        setLastDriveLog(lastLog);
        setForm(prev => ({
            ...prev,
            vehicleId,
            vehicleName: v?.displayName || v?.name || '',
            startKm: km,
        }));
    }, [orgId, form.driveDate, form.startTime, vehicles, isEditMode, editLog, setForm, setLastDriveLog]);

    const handleFavoriteSelect = useCallback((fav: Favorite) => {
        setForm(prev => ({ ...prev, destination: fav.address || fav.destination }));
    }, [setForm]);

    const handleSaveFavorite = useCallback(async () => {
        if (!(form.destination || '').trim() || !user) return;
        try {
            await createFavorite({
                userId: user.uid,
                name: (favName || '').trim() || (form.destination || '').trim(),
                destination: (form.destination || '').trim(),
                organizationId: orgId || '',
            });
            const updated = await getFavorites(user.uid);
            setFavorites(updated as Favorite[]);
            setShowFavSave(false);
            setFavName('');
            showToast('즐겨찾기에 저장되었습니다.', 'success');
        } catch (err) {
            console.error('즐겨찾기 저장 실패:', err);
            captureError(err, { context: 'useDriveLogForm.saveFavorite', destination: form.destination, orgId });
            showToast('즐겨찾기 저장에 실패했습니다.', 'error');
        }
    }, [form.destination, user, favName, orgId, setFavorites, setShowFavSave, setFavName, showToast]);

    const togglePassenger = useCallback((member: UserDoc) => {
        setSelectedPassengers(prev => {
            const exists = prev.find(p => p.id === member.id);
            if (exists) return prev.filter(p => p.id !== member.id);
            return [...prev, member];
        });
    }, [setSelectedPassengers]);

    const toggleCoDriver = useCallback((member: UserDoc) => {
        setSelectedCoDrivers(prev => {
            const exists = prev.find(p => p.id === member.id);
            if (exists) return prev.filter(p => p.id !== member.id);
            return [...prev, member];
        });
    }, [setSelectedCoDrivers]);

    // 대표 운전자 선택 (기본값=작성자 본인)
    const handleSelectDriver = useCallback((driverUid: string, driverName: string) => {
        setForm(prev => ({ ...prev, driverUid, driverName }));
    }, [setForm]);

    // 폼 리셋 시 입력값 초기화 + 대표 운전자를 작성자 본인으로 재주입
    const resetInputs = useCallback(() => {
        setForm({
            ...getEmptyForm(),
            driverUid: user?.uid || '',
            driverName: userData?.name || user?.displayName || user?.email || '',
        });
        setSelectedPassengers([]);
        setExternalPassengerCount(0);
        setSelectedCoDrivers([]);
        setExternalCoDriverNames('');
    }, [setForm, user, userData, setSelectedPassengers, setExternalPassengerCount, setSelectedCoDrivers, setExternalCoDriverNames]);

    // submitDriveLog 재시도 중 발생한 에러 처리. true 반환 시 재시도 중단(에러 무시).
    const handleSubmitError = useCallback((err: unknown): boolean | void => {
        const errObj = err as { code?: string; originalStartKm?: number; suggestedStartKm?: number };
        if (errObj && errObj.code === 'REQUIRES_START_KM_CONFIRMATION') {
            setConfirmStartKm({
                original: errObj.originalStartKm ?? 0,
                suggested: errObj.suggestedStartKm ?? 0
            });
            return true; // 에러 무시하고 재시도 중단 (모달 표시)
        }

        const isDuplicate = err instanceof Error && err.message?.includes('중복');
        const isTimeout = err instanceof Error && err.message?.includes('TIMEOUT');

        if (isDuplicate || isTimeout) {
            console.warn(`[useDriveLogForm] ${err instanceof Error ? err.message : '알 수 없는 경고'}`);
        } else {
            console.error('운행일지 저장 실패:', err);
        }

        if (isDuplicate || isTimeout) {
            if (isTimeout) {
                showToast('네트워크 지연으로 운행일지를 로컬에 임시 저장했습니다. 연결 시 동기화됩니다.', 'success');
            } else {
                showToast('요청된 내용이 정상 반영되어 이미 목록에 저장되었습니다.', 'success');
            }

            setSuccess(true);
            if (reservationData?.reservationId || reservationData?.actualStartTime) {
                navigate('/employee/today', { replace: true });
            } else if (isEditMode) {
                navigate('/employee/my-records', { replace: true });
            } else {
                resetInputs();
                setTimeout(() => setSuccess(false), 2000);
            }
            return true;
        }
        return false;
    }, [reservationData, isEditMode, navigate, showToast, setSuccess, resetInputs]);

    const handleSubmit = useCallback(async (e: React.FormEvent | Event) => {
        if (e && 'preventDefault' in e) e.preventDefault();

        const validation = validateDriveLogForm(form, { isElectric });
        if (!validation.valid) {
            showToast(validation.message as string, 'warning');
            return;
        }

        // ── 수정 모드 범위 검증: 직전/직후 기록의 범위 안에 있는지 확인 ──
        if (isEditMode) {
            const rangeError = validateEditKmRange(form, lastDriveLog, nextDriveLog);
            if (rangeError) {
                setKmRangeError(rangeError);
                return;
            }
        }

        const suggestedStartKm = lastDriveLog 
            ? Number(lastDriveLog.endKm || 0) 
            : Number(selectedVehicle?.currentKm || 0);
        const isManuallyCorrected = Number(form.startKm || 0) !== suggestedStartKm;

        startTransition(async () => {
            try {
                const result = await runWithRetry(
                    'submit-drive-log',
                    () => submitDriveLog({
                        form, orgId, user: user!, userData, selectedVehicle,
                        selectedPassengers, externalPassengerCount, externalPassengerNames,
                        selectedCoDrivers, externalCoDriverNames, isRetroactive,
                        ocrUsed: ocrSuccess, favoriteUsed: false, isElectric, isEditMode, editLog,
                        reservationData, hipassCard,
                        isManuallyCorrected,
                        originalStartKm: isManuallyCorrected ? suggestedStartKm : undefined,
                    }),
                    {
                        timeoutMs: 8000,
                        onError: handleSubmitError,
                    }
                );

                if (!result) return;

                // ── 수정 모드: 인접 기록 자동 조정 (직전 endKm, 직후 startKm) ──
                if (isEditMode) {
                    const adjustMessages = await adjustAdjacentLogs({
                        lastDriveLog,
                        nextDriveLog,
                        startKm: Number(form.startKm || 0),
                        endKm: Number(form.endKm || 0),
                    });
                    if (adjustMessages.length > 0) {
                        showToast(`인접 기록이 자동 조정되었습니다: ${adjustMessages.join(', ')}`, 'info');
                    }
                }

                if (result.syncResult?.updated) {
                    showToast(`다음 기록의 출발 km가 ${result.syncResult.oldStartKm?.toLocaleString()} → ${result.syncResult.newStartKm?.toLocaleString()}으로 자동 갱신되었습니다.`, 'info');
                }
                if (result.correctedKm) {
                    showToast(`동시 작성 감지: 출발 km가 최신 기준인 ${result.correctedKm.oldStartKm?.toLocaleString()} → ${result.correctedKm.correctedStartKm?.toLocaleString()}(으)로 자동 일치되어 저장되었습니다.`, 'info');
                }
                if (result.backgroundWarning) {
                    showToast(result.backgroundWarning, 'warning');
                }

                if (result.offline) {
                    setSuccess(true);
                    showToast(result.message!, 'info');
                    if (result.shouldResetForm) {
                        resetInputs();
                    }
                    setTimeout(() => setSuccess(false), 3000);
                    return;
                }

                setSuccess(true);
                if (result.shouldNavigate === 'my-records') {
                    showToast(result.message || '운행일지가 수정되었습니다.', 'success');
                    navigate('/employee/my-records', { replace: true });
                } else if (result.shouldNavigate === 'today') {
                    showToast(result.message || '예약 운행일지가 저장되었습니다.', 'success');
                    invalidateDashboardCache();
                    navigate('/employee/today', { replace: true });
                } else if (result.shouldResetForm) {
                    resetInputs();
                    setSuccess(false);
                }
            } catch (err: unknown) {
                console.error('운행일지 과정 중 예상치 못한 오류:', err);
                showToast('알 수 없는 오류가 발생했습니다.', 'error');
            }
        });
    }, [
        form, isElectric, showToast, startTransition, runWithRetry,
        orgId, user, userData, selectedVehicle, selectedPassengers, externalPassengerCount,
        externalPassengerNames, selectedCoDrivers, externalCoDriverNames, isRetroactive,
        ocrSuccess, isEditMode, editLog,
        reservationData, hipassCard, handleSubmitError, setSuccess, navigate, resetInputs,
        lastDriveLog, nextDriveLog
    ]);

    const handleConfirmStartKm = useCallback(() => {
        if (!confirmStartKm) return;
        setForm(prev => ({ ...prev, startKm: String(confirmStartKm.suggested) }));
        setConfirmStartKm(null);
        setTimeout(() => {
            handleSubmit(new Event('submit') as unknown as React.FormEvent);
        }, 50);
    }, [confirmStartKm, setForm, handleSubmit]);

    const handleCancelConfirm = useCallback(() => {
        setConfirmStartKm(null);
    }, []);

    const handleDismissKmRangeError = useCallback(() => {
        setKmRangeError(null);
    }, []);

    return {
        confirmStartKm,
        kmRangeError,
        handleDismissKmRangeError,
        handleConfirmStartKm,
        handleCancelConfirm,
        handleVehicleSelect,
        handleFavoriteSelect,
        handleSaveFavorite,
        togglePassenger,
        toggleCoDriver,
        handleSelectDriver,
        handleSubmit
    };
}
