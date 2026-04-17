/**
 * driveLogForm/useDriveLogSubmit.ts
 * 운행일지 폼의 제출 및 사용자 입력 핸들러 모음
 */
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { createFavorite, getFavorites } from '../../lib/firestore';
import { resolveStartKm } from './resolveStartKm';
import { submitDriveLog, getEmptyForm } from './submitDriveLog';
import { validateDriveLogForm } from '../utils/driveLogValidation';
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
    setFavorites: React.Dispatch<React.SetStateAction<Favorite[]>>;
    setShowFavSave: (v: boolean) => void;
    setFavName: (v: string) => void;
    setSuccess: (v: boolean) => void;
    
    // Flags
    isElectric: boolean;
    isQuickDrive: boolean;
    isRetroactive: boolean;
    isEditMode: boolean;
    editLog: DriveLog | null;
    reservationData: LocationState | null;
    hipassCard: HipassCard | null;
    favName: string;
    
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
        setFavorites, setShowFavSave, setFavName, setSuccess,
        isElectric, isQuickDrive, isRetroactive, isEditMode, editLog, reservationData, hipassCard, favName,
        showToast, runWithRetry, startTransition, ocrSuccess
    } = deps;

    const handleVehicleSelect = useCallback(async (vehicleId: string) => {
        const v = vehicles.find(veh => veh.id === vehicleId);
        const km = await resolveStartKm(orgId!, vehicleId, {
            driveDate: form.driveDate,
            startTime: form.startTime,
            vehicle: v || null,
        });
        setForm(prev => ({
            ...prev,
            vehicleId,
            vehicleName: v?.displayName || v?.name || '',
            startKm: km,
        }));
    }, [orgId, form.driveDate, form.startTime, vehicles, setForm]);

    const handleFavoriteSelect = useCallback((fav: Favorite) => {
        setForm(prev => ({ ...prev, destination: fav.address || fav.destination }));
    }, [setForm]);

    const handleSaveFavorite = useCallback(async () => {
        if (!form.destination.trim() || !user) return;
        try {
            await createFavorite({
                userId: user.uid,
                name: favName.trim() || form.destination.trim(),
                destination: form.destination.trim(),
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

    const handleSubmit = async (e: React.FormEvent | Event) => {
        if (e && 'preventDefault' in e) e.preventDefault();

        const validation = validateDriveLogForm(form, { isElectric, isQuickDrive });
        if (!validation.valid) {
            showToast(validation.message as string, 'warning');
            return;
        }

        startTransition(async () => {
            try {
                const result = await runWithRetry(
                    'submit-drive-log',
                    () => submitDriveLog({
                        form, orgId, user: user!, userData, selectedVehicle,
                        selectedPassengers, externalPassengerCount, isRetroactive,
                        ocrUsed: ocrSuccess, favoriteUsed: false, isElectric, isEditMode, editLog,
                        reservationData, hipassCard,
                    }),
                    {
                        timeoutMs: 8000,
                        onError: (err: unknown) => {
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
                                    setForm(getEmptyForm());
                                    setSelectedPassengers([]);
                                    setExternalPassengerCount(0);
                                    setTimeout(() => setSuccess(false), 2000);
                                }
                                return true;
                            }
                            return false; 
                        }
                    }
                );

                if (!result) return;

                if (result.syncResult?.updated) {
                    showToast(`다음 기록의 출발 km가 ${result.syncResult.oldStartKm?.toLocaleString()} → ${result.syncResult.newStartKm?.toLocaleString()}으로 자동 조정되었습니다.`, 'info');
                }
                if (result.correctedKm) {
                    showToast(`동시 작성 감지: 출발 km가 최신 기준인 ${result.correctedKm.oldStartKm?.toLocaleString()} → ${result.correctedKm.correctedStartKm?.toLocaleString()}(으)로 자동 보정 저장되었습니다.`, 'info');
                }
                if (result.backgroundWarning) {
                    showToast(result.backgroundWarning, 'warning');
                }

                if (result.offline) {
                    setSuccess(true);
                    showToast(result.message!, 'info');
                    if (result.shouldResetForm) {
                        setForm(getEmptyForm());
                        setSelectedPassengers([]);
                        setExternalPassengerCount(0);
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
                    navigate('/employee/today', { replace: true });
                } else if (result.shouldResetForm) {
                    setForm(getEmptyForm());
                    setSelectedPassengers([]);
                    setExternalPassengerCount(0);
                    setSuccess(false);
                }
            } catch (err: unknown) {
                console.error('운행일지 과정 중 예상치 못한 오류:', err);
                showToast('알 수 없는 오류가 발생했습니다.', 'error');
            }
        });
    };

    return {
        handleVehicleSelect,
        handleFavoriteSelect,
        handleSaveFavorite,
        togglePassenger,
        handleSubmit
    };
}
