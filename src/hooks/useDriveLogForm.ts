/**
 * useDriveLogForm — 운행일지 작성/수정 폼의 상태 관리 + 비즈니스 로직
 * DriveLogForm에서 추출된 커스텀 훅
 */
import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './useAuth';
import { useToast } from './useToast';
import useRetry from './useRetry';
import useDriveLogOcr from './useDriveLogOcr';
import { nowTime, todayStr, validateDriveLogForm, buildLogData } from './utils/driveLogValidation';
import { getVehicles, createDriveLog, updateDriveLog, updateReservationStatus, getFavorites, createFavorite, getOrganizationMembers, getLastVehicleEndKm, getVehicleEndKmBefore } from '../lib/firestore';
import type { Vehicle } from '../types/vehicle';
import type { Favorite } from '../types/favorite';
import type { User as UserDoc } from '../types/user';
import type { DriveLog } from '../types/driveLog';

export interface DriveLogForm {
    vehicleId: string;
    vehicleName: string;
    purpose: string;
    destination: string;
    startTime: string;
    endTime: string;
    startKm: string;
    endKm: string;
    fuelAmount: string;
    batteryStart: string;
    batteryEnd: string;
    notes: string;
    driveDate: string;
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
        continueFrom?: {
            id: string;
            vehicleId: string;
            vehicleName?: string;
            endKm?: number;
            destination?: string;
        };
        editLog?: DriveLog & { passengerNames?: string[] };
    }

    const state = location.state as LocationState | null;
    const reservationData = state?.reservationId ? state : null;
    const continueFrom = state?.continueFrom || null;
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
    const [externalPassengers, setExternalPassengers] = useState<string[]>([]);
    const [showFavSave, setShowFavSave] = useState(false);
    const [favName, setFavName] = useState('');

    // 수정 모드: 기존 기록의 날짜, 그 외: 오늘
    const editDriveDate = (() => {
        if (!editLog?.timestamp) return todayStr();
        let d: Date;
        const ts = editLog.timestamp as unknown;
        if (ts && typeof ts === 'object' && 'toDate' in ts && typeof (ts as { toDate: () => Date }).toDate === 'function') {
            d = (ts as { toDate: () => Date }).toDate();
        } else if (ts && typeof ts === 'object' && 'seconds' in ts) {
            d = new Date((ts as { seconds: number }).seconds * 1000);
        } else if (ts instanceof Date) {
            d = ts;
        } else {
            d = new Date(ts as string | number);
        }
        if (isNaN(d.getTime())) return todayStr();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();

    const [form, setForm] = useState<DriveLogForm>({
        vehicleId: editLog?.vehicleId || '',
        vehicleName: editLog?.vehicleName || '',
        purpose: editLog?.purpose || '',
        destination: editLog?.destination || '',
        startTime: editLog?.startTime as string || reservationData?.actualStartTime || (isQuickDrive ? '' : nowTime()),
        endTime: editLog?.endTime as string || '',
        startKm: editLog?.startKm?.toString() || '',
        endKm: editLog?.endKm?.toString() || '',
        fuelAmount: editLog?.fuelAmount?.toString() || '',
        batteryStart: editLog?.batteryStart?.toString() || '',
        batteryEnd: editLog?.batteryEnd?.toString() || '',
        notes: editLog?.notes || '',
        driveDate: editDriveDate,
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
                    // 조직원 이름에 매칭되지 않은 이름 = 외부 동승자
                    const memberNames = otherMembers.map(m => m.name || m.email?.split('@')[0]);
                    const externals = editLog.passengerNames.filter(n => !memberNames.includes(n));
                    if (externals.length > 0) setExternalPassengers(externals);
                }

                const resolveStartKm = async (vehicleId: string, fallbackKm: number | string | undefined) => {
                    const lastEndKm = await getLastVehicleEndKm(orgId, vehicleId);
                    return (lastEndKm ?? fallbackKm ?? '').toString();
                };

                if (isEditMode) {
                    // 수정 모드 유지
                } else if (continueFrom) {
                    const cv = v.find(veh => veh.id === continueFrom.vehicleId);
                    const km = await resolveStartKm(continueFrom.vehicleId, continueFrom.endKm || cv?.currentKm);
                    setForm(prev => ({
                        ...prev,
                        vehicleId: continueFrom.vehicleId,
                        vehicleName: continueFrom.vehicleName || cv?.displayName || '',
                        startKm: km,
                        startTime: nowTime(),
                    }));
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
    }, [orgId, reservationData, continueFrom, user]);

    useEffect(() => {
        if (!orgId || !form.vehicleId || !form.driveDate) return;
        const refreshStartKm = async () => {
            let km: number | string;
            if (form.driveDate !== todayStr()) {
                const [y, m, d] = form.driveDate.split('-').map(Number);
                const beforeDate = new Date(y, m - 1, d);
                km = await getVehicleEndKmBefore(orgId, form.vehicleId, beforeDate) ?? '';
                if (km === '') {
                    const v = vehicles.find(veh => veh.id === form.vehicleId);
                    km = v?.currentKm ?? '';
                }
            } else {
                const lastEndKm = await getLastVehicleEndKm(orgId, form.vehicleId);
                const v = vehicles.find(veh => veh.id === form.vehicleId);
                km = lastEndKm ?? v?.currentKm ?? '';
            }
            setForm(prev => ({ ...prev, startKm: km.toString() }));
        };
        refreshStartKm();
    }, [form.driveDate, form.vehicleId, orgId, vehicles]);

    const handleVehicleSelect = async (vehicleId: string) => {
        const v = vehicles.find(veh => veh.id === vehicleId);
        let km: number | string;
        if (form.driveDate && form.driveDate !== todayStr()) {
            const [y, m, d] = form.driveDate.split('-').map(Number);
            const beforeDate = new Date(y, m - 1, d);
            km = await getVehicleEndKmBefore(orgId!, vehicleId, beforeDate) ?? v?.currentKm ?? '';
        } else {
            const lastEndKm = await getLastVehicleEndKm(orgId!, vehicleId);
            km = lastEndKm ?? v?.currentKm ?? '';
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
                orgId, user: user!, userData, selectedVehicle, selectedPassengers, externalPassengers, isRetroactive,
            });

            if (isEditMode && editLog) {
                const result = await updateDriveLog(editLog.id, logData);
                const syncResult = (result as Record<string, unknown>)?.syncResult as { updated?: boolean; oldStartKm?: number; newStartKm?: number } | undefined;
                if (syncResult?.updated) {
                    showToast(`다음 기록의 출발 km가 ${syncResult.oldStartKm?.toLocaleString()} → ${syncResult.newStartKm?.toLocaleString()}으로 자동 조정되었습니다.`, 'info');
                }
            } else {
                const extendedLogData = { ...logData, reservationId: reservationData?.reservationId || null, linkedLogId: continueFrom?.id || null };
                const result = await createDriveLog(extendedLogData as Parameters<typeof createDriveLog>[0]);
                const syncResult = (result as Record<string, unknown>)?.syncResult as { updated?: boolean; oldStartKm?: number; newStartKm?: number } | undefined;
                if (syncResult?.updated) {
                    showToast(`다음 기록의 출발 km가 ${syncResult.oldStartKm?.toLocaleString()} → ${syncResult.newStartKm?.toLocaleString()}으로 자동 조정되었습니다.`, 'info');
                }
            }

            if (!isEditMode && reservationData?.reservationId) {
                await updateReservationStatus(reservationData.reservationId, 'completed', {
                    actualStartTime: form.startTime || '',
                    actualEndTime: form.endTime || nowTime(),
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
                    startKm: '', endKm: '', fuelAmount: '', startTime: nowTime(),
                    endTime: '', batteryStart: '', batteryEnd: '', notes: '',
                    driveDate: todayStr(),
                });
                setSelectedPassengers([]);
                setExternalPassengers([]);
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
        reservationData, continueFrom, isQuickDrive,
        editLog, isEditMode, isRetroactive,
        showFavSave, setShowFavSave,
        favName, setFavName,
        ocrLoading: ocr.ocrLoading,
        ocrError: ocr.ocrError,
        ocrSuccess: ocr.ocrSuccess,
        ocrReportSending: ocr.ocrReportSending,
        ocrReportSent: ocr.ocrReportSent,
        cameraInputRef: ocr.cameraInputRef,
        endKmInputRef: ocr.endKmInputRef,
        handleVehicleSelect,
        handleFavoriteSelect,
        handleSaveFavorite,
        togglePassenger,
        externalPassengers,
        addExternalPassenger: (name: string) => {
            const trimmed = name.trim();
            if (trimmed && !externalPassengers.includes(trimmed)) {
                setExternalPassengers(prev => [...prev, trimmed]);
            }
        },
        removeExternalPassenger: (name: string) => {
            setExternalPassengers(prev => prev.filter(n => n !== name));
        },
        handleOcrCapture: ocr.handleOcrCapture,
        handleOcrReport: ocr.handleOcrReport,
        handleSubmit,
    };
}
