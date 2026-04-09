/**
 * useDriveLogForm — 운행일지 작성/수정 폼의 상태 관리 + 비즈니스 로직
 * DriveLogForm에서 추출된 커스텀 훅
 */
import { useState, useEffect } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from './useAuth';
import { useToast } from './useToast';
import useRetry from './useRetry';
import useDriveLogOcr from './useDriveLogOcr';
import { nowTime, todayStr, validateDriveLogForm, buildLogData, timestampToDateStr } from './utils/driveLogValidation';
import { getVehicles, createDriveLog, updateDriveLog, updateReservationStatus, getFavorites, createFavorite, getOrganizationMembers, getLastVehicleEndKm, getLastVehicleEndBattery, getVehicleEndKmBefore, getReservationById, getHipassCards, updateHipassCard } from '../lib/firestore';
import { enqueueLog } from '../lib/offlineQueue';
import type { Vehicle } from '../types/vehicle';

const clearDrivingNotification = async (resId?: string) => {
    if (!resId || !('Notification' in window)) return;
    try {
        const reg = await navigator.serviceWorker?.ready;
        if (!reg) return;
        const notifications = await reg.getNotifications({ tag: `driving-${resId}` });
        notifications.forEach(n => n.close());
    } catch {
        // 무시
    }
};
import type { Favorite } from '../types/favorite';
import type { User as UserDoc } from '../types/user';
import type { DriveLog } from '../types/driveLog';
import type { HipassCard } from '../types/hipass';

export interface DriveLogForm {
    vehicleId: string;
    vehicleName: string;
    purpose: string;
    destination: string;
    startTime: string;
    endTime: string;
    startKm: string;
    endKm: string;
    batteryStart: string;
    batteryEnd: string;
    notes: string;
    driveDate: string;
    hipassBalanceAfter: string;
}

export default function useDriveLogForm() {
    const { user, userData } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const { showToast } = useToast();
    useRetry();

    interface LocationState {
        reservationId?: string;
        vehicleId?: string;
        vehicleName?: string;
        purpose?: string;
        destination?: string;
        actualStartTime?: string;
        currentKm?: number;
        editLog?: DriveLog & { passengerNames?: string[] };
    }

    const state = location.state as LocationState | null;
    const [searchParams] = useSearchParams();
    const queryReservationId = searchParams.get('reservationId');

    // location.state 또는 URL 쿼리에서 예약 데이터 결정
    const [resolvedReservationData, setResolvedReservationData] = useState<LocationState | null>(
        state?.reservationId ? state : null
    );
    const reservationData = resolvedReservationData;
    const editLog = state?.editLog || null;
    const isEditMode = !!editLog;
    const isQuickDrive = false;

    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [favorites, setFavorites] = useState<Favorite[]>([]);
    const [members, setMembers] = useState<UserDoc[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const [selectedPassengers, setSelectedPassengers] = useState<UserDoc[]>([]);
    const [externalPassengerCount, setExternalPassengerCount] = useState(0);
    const [showFavSave, setShowFavSave] = useState(false);
    const [favName, setFavName] = useState('');
    const [hipassCard, setHipassCard] = useState<HipassCard | null>(null);
    const [lastEndBattery, setLastEndBattery] = useState<number | null>(null);

    const editDriveDate = editLog?.timestamp ? timestampToDateStr(editLog.timestamp) : todayStr();

    const [form, setForm] = useState<DriveLogForm>({
        vehicleId: editLog?.vehicleId || '',
        vehicleName: editLog?.vehicleName || '',
        purpose: editLog?.purpose || '',
        destination: editLog?.destination || '',
        startTime: editLog?.startTime as string || reservationData?.actualStartTime || (isQuickDrive ? '' : nowTime()),
        endTime: editLog?.endTime as string || '',
        startKm: editLog?.startKm?.toString() || '',
        endKm: editLog?.endKm?.toString() || '',
        batteryStart: editLog?.batteryStart?.toString() || '',
        batteryEnd: editLog?.batteryEnd?.toString() || '',
        notes: editLog?.notes || '',
        driveDate: editDriveDate,
        hipassBalanceAfter: '',
    });

    const orgId = userData?.organizationId;

    const selectedVehicle = vehicles.find(v => v.id === form.vehicleId);
    const isElectric = selectedVehicle?.fuelType === 'electric';
    const isRetroactive = form.driveDate !== todayStr();

    // OCR 서브 훅
    const ocr = useDriveLogOcr({ isElectric, setForm, user, userData, vehicleName: form.vehicleName });

    useEffect(() => {
        if (!orgId || !user) return;
        const fetch = async () => {
            try {
                const [v, favs, mems] = await Promise.all([
                    getVehicles(orgId),
                    getFavorites(user.uid),
                    getOrganizationMembers(orgId),
                ]);
                setVehicles(v as Vehicle[]);
                setFavorites(favs as Favorite[]);
                const otherMembers = (mems as UserDoc[]).filter(m => m.id !== user.uid);
                setMembers(otherMembers);

                if (isEditMode && editLog?.passengerNames && editLog.passengerNames.length > 0) {
                    const matched = otherMembers.filter(m =>
                        editLog.passengerNames?.includes(m.name || m.email?.split('@')[0])
                    );
                    setSelectedPassengers(matched);
                    // 조직원 이름에 매칭되지 않은 수 = 외부 동승자 수
                    const memberNames = otherMembers.map(m => m.name || m.email?.split('@')[0]);
                    const externals = editLog.passengerNames.filter(n => !memberNames.includes(n));
                    if (externals.length > 0) setExternalPassengerCount(externals.length);
                }

                const resolveStartKm = async (vehicleId: string, fallbackKm: number | string | undefined) => {
                    const lastEndKm = await getLastVehicleEndKm(orgId, vehicleId);
                    const k1 = Number(fallbackKm || 0);
                    const k2 = Number(lastEndKm || 0);
                    return (Math.max(k1, k2) || '').toString();
                };

                if (isEditMode) {
                    // 수정 모드 유지
                } else if (reservationData?.vehicleId) {
                    const rv = v.find(veh => veh.id === reservationData.vehicleId);
                    const km = await resolveStartKm(reservationData.vehicleId!, rv?.currentKm ?? reservationData.currentKm);
                    setForm(prev => ({
                        ...prev,
                        vehicleId: reservationData.vehicleId!,
                        vehicleName: reservationData.vehicleName || rv?.displayName || '',
                        purpose: reservationData.purpose || '',
                        destination: reservationData.destination || '',
                        startKm: km,
                    }));
                } else if (v.length === 1) {
                    const km = await resolveStartKm(v[0].id, v[0].currentKm);
                    setForm(prev => ({ ...prev, vehicleId: v[0].id, vehicleName: v[0].displayName || v[0].name, startKm: km }));
                }
            } catch (err) {
                console.error('데이터 로드 실패:', err);
            } finally {
                setLoading(false);
            }
        };
        fetch();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orgId, reservationData, user]);

    // URL 쿼리 파라미터에서 reservationId로 예약 데이터 로드 (알림 클릭 시)
    useEffect(() => {
        if (!queryReservationId || resolvedReservationData || !orgId) return;
        const loadReservation = async () => {
            try {
                const res = await getReservationById(queryReservationId);
                if (res) {
                    if (res.status === 'completed') {
                        showToast('이미 운행일지 작성이 완료된 건입니다.', 'info');
                        clearDrivingNotification(queryReservationId);
                        navigate('/employee/today', { replace: true });
                        return;
                    }

                    const data: LocationState = {
                        reservationId: res.id,
                        vehicleId: res.vehicleId,
                        vehicleName: res.vehicleName || res.vehicleDisplayName,
                        purpose: res.purpose || '',
                        destination: res.destination || '',
                        actualStartTime: res.actualStartTime || '',
                        currentKm: res.currentKm || 0,
                    };
                    setResolvedReservationData(data);

                    // 폼에 예약 정보 반영
                    setForm(prev => ({
                        ...prev,
                        vehicleId: data.vehicleId || '',
                        vehicleName: data.vehicleName || '',
                        purpose: data.purpose || '',
                        destination: data.destination || '',
                        startTime: data.actualStartTime || prev.startTime,
                    }));

                    // startKm 조회 (현재차량정보가 우선)
                    const lastEndKm = await getLastVehicleEndKm(orgId, data.vehicleId!);
                    const km = (data.currentKm ?? lastEndKm ?? '').toString();
                    setForm(prev => ({ ...prev, startKm: km }));
                }
            } catch (err) {
                console.error('예약 데이터 로드 실패:', err);
            }
        };
        loadReservation();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [queryReservationId, orgId]);

    useEffect(() => {
        // 수정 모드에서는 기존 기록의 startKm을 유지 (최신 endKm으로 덮어쓰지 않음)
        if (isEditMode) return;
        if (!orgId || !form.vehicleId || !form.driveDate) return;
        const refreshStartKm = async () => {
            let km: number | string;
            const v = vehicles.find(veh => veh.id === form.vehicleId);
            
            if (form.driveDate !== todayStr()) {
                // 과거 날짜: 해당 날짜 이전의 마지막 endKm
                const [y, m, d] = form.driveDate.split('-').map(Number);
                const beforeDate = new Date(y, m - 1, d);
                const fetchedKm = await getVehicleEndKmBefore(orgId, form.vehicleId, beforeDate);
                km = fetchedKm !== null ? fetchedKm : (v?.currentKm ?? '');
            } else if (form.startTime) {
                // 오늘 + 출발 시각: 해당 시각 이전의 마지막 endKm (같은 날 소급)
                const [y, m, d] = form.driveDate.split('-').map(Number);
                const [h, min] = form.startTime.split(':').map(Number);
                const beforeTime = new Date(y, m - 1, d, h, min);
                const fetchedKm = await getVehicleEndKmBefore(orgId, form.vehicleId, beforeTime);
                km = fetchedKm !== null ? fetchedKm : (v?.currentKm ?? '');
            } else {
                // 오늘 + 출발 시각 없음: 기본 동작
                const lastEndKm = await getLastVehicleEndKm(orgId, form.vehicleId);
                const k1 = Number(v?.currentKm || 0);
                const k2 = Number(lastEndKm || 0);
                km = Math.max(k1, k2) || '';
            }
            setForm(prev => ({ ...prev, startKm: km.toString() }));
        };
        refreshStartKm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [form.driveDate, form.vehicleId, form.startTime, orgId, vehicles]);

    // 전기차: 이전 운행일지의 도착 배터리 조회 (출발 배터리 placeholder 힌트)
    useEffect(() => {
        if (!orgId || !form.vehicleId || !isElectric) {
            setLastEndBattery(null);
            return;
        }
        getLastVehicleEndBattery(orgId, form.vehicleId)
            .then(val => setLastEndBattery(val))
            .catch(() => setLastEndBattery(null));
    }, [orgId, form.vehicleId, isElectric]);

    // 차량 변경 시 해당 차량에 연결된 하이패스 카드 조회
    useEffect(() => {
        if (!orgId || !form.vehicleId) {
            setHipassCard(null);
            return;
        }
        const loadHipass = async () => {
            try {
                const cards = await getHipassCards(orgId);
                const card = cards.find((c: HipassCard) => c.vehicleId === form.vehicleId);
                setHipassCard(card || null);
                if (card) {
                    setForm(prev => ({ ...prev, hipassBalanceAfter: '' }));
                }
            } catch {
                setHipassCard(null);
            }
        };
        loadHipass();
    }, [orgId, form.vehicleId]);

    const handleVehicleSelect = async (vehicleId: string) => {
        const v = vehicles.find(veh => veh.id === vehicleId);
        let km: number | string;
        if (form.driveDate && form.driveDate !== todayStr()) {
            // 과거 날짜
            const [y, m, d] = form.driveDate.split('-').map(Number);
            const beforeDate = new Date(y, m - 1, d);
            const fetchedKm = await getVehicleEndKmBefore(orgId!, vehicleId, beforeDate);
            km = fetchedKm !== null ? fetchedKm : (v?.currentKm ?? '');
        } else if (form.startTime) {
            // 오늘 + 출발 시각: 해당 시각 이전의 마지막 endKm
            const dateStr = form.driveDate || todayStr();
            const [y, m, d] = dateStr.split('-').map(Number);
            const [h, min] = form.startTime.split(':').map(Number);
            const beforeTime = new Date(y, m - 1, d, h, min);
            const fetchedKm = await getVehicleEndKmBefore(orgId!, vehicleId, beforeTime);
            km = fetchedKm !== null ? fetchedKm : (v?.currentKm ?? '');
        } else {
            // 오늘 + 출발 시각 없음: 기본 동작
            const lastEndKm = await getLastVehicleEndKm(orgId!, vehicleId);
            const k1 = Number(v?.currentKm || 0);
            const k2 = Number(lastEndKm || 0);
            km = Math.max(k1, k2) || '';
        }
        setForm(prev => ({
            ...prev,
            vehicleId,
            vehicleName: v?.displayName || v?.name || '',
            startKm: km.toString(),
        }));
    };

    const handleFavoriteSelect = (fav: Favorite) => {
        setForm(prev => ({ ...prev, destination: fav.address || fav.destination }));
    };

    const handleSaveFavorite = async () => {
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
        } catch (err) {
            console.error('즐겨찾기 저장 실패:', err);
        }
    };

    const togglePassenger = (member: UserDoc) => {
        setSelectedPassengers(prev => {
            const exists = prev.find(p => p.id === member.id);
            if (exists) return prev.filter(p => p.id !== member.id);
            return [...prev, member];
        });
    };

    const handleSubmit = async (e: React.FormEvent | Event) => {
        if (e && 'preventDefault' in e) e.preventDefault();

        const validation = validateDriveLogForm(form, { isElectric, isQuickDrive });
        if (!validation.valid) {
            showToast(validation.message as string, 'warning');
            return;
        }

        setSubmitting(true);
        try {
            const logData = buildLogData(form, {
                orgId, user: user!, userData, selectedVehicle, selectedPassengers, externalPassengerCount, isRetroactive, ocrUsed: ocr.ocrSuccess,
            });

            // 하이패스 정보를 운행일지에 저장
            if (hipassCard && form.hipassBalanceAfter !== '') {
                Object.assign(logData, {
                    hipassCardNumber: hipassCard.cardNumber || '',
                    hipassBalanceBefore: hipassCard.balance,
                    hipassBalanceAfter: Number(form.hipassBalanceAfter),
                });
            }

            if (isEditMode && editLog) {
                // 오프라인 감지: 수정도 큐잉
                if (!navigator.onLine) {
                    await enqueueLog(logData as Record<string, unknown>, 'update', editLog.id);
                    setSuccess(true);
                    showToast('오프라인에서 수정 저장됨 · 온라인 복귀 시 자동 반영', 'info');
                    setTimeout(() => setSuccess(false), 3000);
                    setSubmitting(false);
                    return;
                }
                const result = await updateDriveLog(editLog.id, logData);
                const syncResult = (result as Record<string, unknown>)?.syncResult as { updated?: boolean; oldStartKm?: number; newStartKm?: number } | undefined;
                if (syncResult?.updated) {
                    showToast(`다음 기록의 출발 km가 ${syncResult.oldStartKm?.toLocaleString()} → ${syncResult.newStartKm?.toLocaleString()}으로 자동 조정되었습니다.`, 'info');
                }
            } else {
                const extendedLogData = { ...logData, reservationId: reservationData?.reservationId || null };

                // 오프라인 감지: IndexedDB 큐에 저장
                if (!navigator.onLine) {
                    await enqueueLog(extendedLogData as Record<string, unknown>);
                    setSuccess(true);
                    showToast('오프라인에서 저장됨 · 온라인 복귀 시 자동 전송', 'info');
                    setForm({
                        vehicleId: '', vehicleName: '', purpose: '', destination: '',
                        startKm: '', endKm: '', startTime: nowTime(),
                        endTime: '', batteryStart: '', batteryEnd: '', notes: '',
                        driveDate: todayStr(), hipassBalanceAfter: '',
                    });
                    setSelectedPassengers([]);
                    setExternalPassengerCount(0);
                    setTimeout(() => setSuccess(false), 3000);
                    setSubmitting(false);
                    return;
                }

                const result = await createDriveLog(extendedLogData as Parameters<typeof createDriveLog>[0]);
                const syncResult = (result as Record<string, unknown>)?.syncResult as { updated?: boolean; oldStartKm?: number; newStartKm?: number } | undefined;
                if (syncResult?.updated) {
                    showToast(`다음 기록의 출발 km가 ${syncResult.oldStartKm?.toLocaleString()} → ${syncResult.newStartKm?.toLocaleString()}으로 자동 조정되었습니다.`, 'info');
                }

                const autocorrectedKm = (result as Record<string, unknown>)?.correctedStartKm as number | undefined;
                const origStartKm = (result as Record<string, unknown>)?.oldStartKm as number | undefined;
                if (autocorrectedKm !== undefined) {
                    showToast(`동시 작성 감지: 출발 km가 최신 기준인 ${origStartKm?.toLocaleString()} → ${autocorrectedKm?.toLocaleString()}(으)로 자동 보정 저장되었습니다.`, 'info');
                }
            }

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

            setSuccess(true);
            if (isEditMode) {
                showToast('운행일지가 수정되었습니다.', 'success');
                setTimeout(() => navigate('/employee/my-records', { replace: true }), 1500);
            } else if (reservationData?.reservationId) {
                setTimeout(() => navigate('/employee/today', { replace: true }), 1500);
            } else {
                setForm({
                    vehicleId: '', vehicleName: '', purpose: '', destination: '',
                    startKm: '', endKm: '', startTime: nowTime(),
                    endTime: '', batteryStart: '', batteryEnd: '', notes: '',
                    driveDate: todayStr(), hipassBalanceAfter: '',
                });
                setSelectedPassengers([]);
                setExternalPassengerCount(0);
                setTimeout(() => setSuccess(false), 3000);
            }
        } catch (err: unknown) {
            console.error('운행일지 저장 실패:', err);
            if (err instanceof Error && err.message?.includes('중복')) {
                showToast(err.message, 'warning');
            } else {
                showToast('저장에 실패했습니다.', 'error', {
                    actionLabel: '재시도',
                    onAction: () => handleSubmit(new Event('submit')),
                });
            }
        } finally {
            setSubmitting(false);
        }
    };

    return {
        form, setForm,
        vehicles, favorites, members,
        loading, submitting, success,
        selectedPassengers, selectedVehicle,
        isElectric,
        reservationData, isQuickDrive,
        editLog, isEditMode, isRetroactive,
        showFavSave, setShowFavSave,
        favName, setFavName,
        hipassCard,
        lastEndBattery,
        ocrLoading: ocr.ocrLoading,
        ocrError: ocr.ocrError,
        ocrSuccess: ocr.ocrSuccess,
        ocrImageUrl: ocr.ocrImageUrl,
        ocrReportSending: ocr.ocrReportSending,
        ocrReportSent: ocr.ocrReportSent,
        cameraInputRef: ocr.cameraInputRef,
        endKmInputRef: ocr.endKmInputRef,
        handleVehicleSelect,
        handleFavoriteSelect,
        handleSaveFavorite,
        togglePassenger,
        externalPassengerCount, setExternalPassengerCount,
        handleOcrCapture: ocr.handleOcrCapture,
        handleOcrReport: ocr.handleOcrReport,
        handleSubmit,
    };
}
