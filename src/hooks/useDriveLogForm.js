/**
 * useDriveLogForm — 운행일지 작성/수정 폼의 상태 관리 + 비즈니스 로직
 * DriveLogForm에서 추출된 커스텀 훅
 *
 * 리팩토링: OCR → useDriveLogOcr, 검증/계산 → utils/driveLogValidation
 */
import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './useAuth';
import { useToast } from './useToast';
import useRetry from './useRetry';
import useDriveLogOcr from './useDriveLogOcr';
import { nowTime, todayStr, validateDriveLogForm, buildLogData } from './utils/driveLogValidation';
import { getVehicles, createDriveLog, updateDriveLog, updateReservationStatus, getFavorites, createFavorite, getOrganizationMembers, getLastVehicleEndKm, getVehicleEndKmBefore } from '../lib/firestore';

export default function useDriveLogForm() {
    const { user, userData } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const { showToast } = useToast();
    useRetry();
    const reservationData = location.state?.reservationId ? location.state : null;
    const continueFrom = location.state?.continueFrom || null;
    const editLog = location.state?.editLog || null;
    const isEditMode = !!editLog;
    const isQuickDrive = false; // 하위 호환: QuickDriveStart로 분리됨


    const [vehicles, setVehicles] = useState([]);
    const [favorites, setFavorites] = useState([]);
    const [members, setMembers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const [selectedPassengers, setSelectedPassengers] = useState([]);
    const [showFavSave, setShowFavSave] = useState(false);
    const [favName, setFavName] = useState('');

    // 수정 모드: 기존 기록의 날짜, 그 외: 오늘
    const editDriveDate = (() => {
        if (!editLog?.timestamp) return todayStr();
        // Firestore Timestamp → Router state 직렬화 시 toDate() 유실 대응
        let d;
        if (typeof editLog.timestamp?.toDate === 'function') {
            d = editLog.timestamp.toDate();
        } else if (editLog.timestamp?.seconds) {
            d = new Date(editLog.timestamp.seconds * 1000);
        } else {
            d = new Date(editLog.timestamp);
        }
        if (isNaN(d.getTime())) return todayStr();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();

    const [form, setForm] = useState({
        vehicleId: editLog?.vehicleId || '',
        vehicleName: editLog?.vehicleName || '',
        purpose: editLog?.purpose || '',
        destination: editLog?.destination || '',
        startTime: editLog?.startTime || reservationData?.actualStartTime || (isQuickDrive ? '' : nowTime()),
        endTime: editLog?.endTime || '',
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


    /* eslint-disable react-hooks/exhaustive-deps */
    useEffect(() => {
        if (!orgId) return;
        const fetch = async () => {
            try {
                const [v, favs, mems] = await Promise.all([
                    getVehicles(orgId),
                    getFavorites(user.uid),
                    getOrganizationMembers(orgId),
                ]);
                setVehicles(v);
                setFavorites(favs);
                const otherMembers = mems.filter(m => m.id !== user.uid);
                setMembers(otherMembers);

                // 수정 모드: 기존 동승자 매칭
                if (isEditMode && editLog.passengerNames?.length > 0) {
                    const matched = otherMembers.filter(m =>
                        editLog.passengerNames.includes(m.name || m.email?.split('@')[0])
                    );
                    setSelectedPassengers(matched);
                }

                // 차량의 마지막 운행 endKm 조회 헬퍼
                const resolveStartKm = async (vehicleId, fallbackKm) => {
                    const lastEndKm = await getLastVehicleEndKm(orgId, vehicleId);
                    return (lastEndKm ?? fallbackKm ?? '').toString();
                };

                // 수정 모드에서는 이미 폼이 초기화되어 있으므로 추가 초기화 불필요
                if (isEditMode) {
                    // 차량 정보만 보충
                } else if (continueFrom) {
                    // 이어서 기록에서 넘어온 경우
                    const cv = v.find(veh => veh.id === continueFrom.vehicleId);
                    const km = await resolveStartKm(continueFrom.vehicleId, continueFrom.endKm || cv?.currentKm);
                    setForm(prev => ({
                        ...prev,
                        vehicleId: continueFrom.vehicleId,
                        vehicleName: continueFrom.vehicleName || cv?.displayName || '',
                        startKm: km,
                        startTime: nowTime(),
                    }));
                }
                // 예약에서 넘어온 경우
                else if (reservationData?.vehicleId) {
                    const rv = v.find(veh => veh.id === reservationData.vehicleId);
                    const km = await resolveStartKm(reservationData.vehicleId, rv?.currentKm ?? reservationData.currentKm);
                    setForm(prev => ({
                        ...prev,
                        vehicleId: reservationData.vehicleId,
                        vehicleName: reservationData.vehicleName || rv?.displayName || '',
                        purpose: reservationData.purpose || '',
                        destination: reservationData.destination || '',
                        startKm: km,
                    }));
                }
                else if (v.length === 1) {
                    const km = await resolveStartKm(v[0].id, v[0].currentKm);
                    setForm(prev => ({ ...prev, vehicleId: v[0].id, vehicleName: v[0].displayName, startKm: km }));
                }
            } catch (err) {
                console.error('데이터 로드 실패:', err);
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, [orgId, reservationData, continueFrom]);
    /* eslint-enable react-hooks/exhaustive-deps */

    // 소급 입력: 날짜 변경 시 선택된 차량의 startKm을 해당 날짜 기준으로 재조회
    useEffect(() => {
        if (!orgId || !form.vehicleId || !form.driveDate) return;
        const refreshStartKm = async () => {
            let km;
            if (form.driveDate !== todayStr()) {
                const [y, m, d] = form.driveDate.split('-').map(Number);
                const beforeDate = new Date(y, m - 1, d);
                km = await getVehicleEndKmBefore(orgId, form.vehicleId, beforeDate);
                if (km == null) {
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [form.driveDate]);

    const handleVehicleSelect = async (vehicleId) => {
        const v = vehicles.find(veh => veh.id === vehicleId);
        // 소급 입력 시 해당 날짜 직전 기록의 endKm 사용
        let km;
        if (form.driveDate && form.driveDate !== todayStr()) {
            const [y, m, d] = form.driveDate.split('-').map(Number);
            const beforeDate = new Date(y, m - 1, d); // 해당 날짜 시작 시점
            km = await getVehicleEndKmBefore(orgId, vehicleId, beforeDate);
            if (km == null) km = v?.currentKm ?? '';
        } else {
            const lastEndKm = await getLastVehicleEndKm(orgId, vehicleId);
            km = lastEndKm ?? v?.currentKm ?? '';
        }
        setForm(prev => ({
            ...prev,
            vehicleId,
            vehicleName: v?.displayName || '',
            startKm: km.toString(),
        }));
    };

    const handleFavoriteSelect = (fav) => {
        setForm(prev => ({ ...prev, destination: fav.address || fav.name }));
    };

    const handleSaveFavorite = async () => {
        if (!form.destination.trim()) return;
        try {
            await createFavorite({
                userId: user.uid,
                name: favName.trim() || form.destination.trim(),
                address: form.destination.trim(),
                organizationId: orgId,
            });
            const updated = await getFavorites(user.uid);
            setFavorites(updated);
            setShowFavSave(false);
            setFavName('');
        } catch (err) {
            console.error('즐겨찾기 저장 실패:', err);
        }
    };

    const togglePassenger = (member) => {
        setSelectedPassengers(prev => {
            const exists = prev.find(p => p.id === member.id);
            if (exists) return prev.filter(p => p.id !== member.id);
            return [...prev, member];
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        // 검증 (유틸리티 사용)
        const validation = validateDriveLogForm(form, { isElectric, isQuickDrive });
        if (!validation.valid) {
            showToast(validation.message, 'warning');
            return;
        }

        setSubmitting(true);
        try {
            const logData = buildLogData(form, {
                orgId, user, userData, selectedVehicle, selectedPassengers, isRetroactive,
            });

            if (isEditMode) {
                // 수정 모드: 기존 문서 업데이트
                const { syncResult } = await updateDriveLog(editLog.id, logData) || {};
                if (syncResult?.updated) {
                    showToast(`다음 기록의 출발 km가 ${syncResult.oldStartKm?.toLocaleString()} → ${syncResult.newStartKm?.toLocaleString()}으로 자동 조정되었습니다.`, 'info');
                }
            } else {
                // 생성 모드
                logData.reservationId = reservationData?.reservationId || null;
                logData.linkedLogId = continueFrom?.id || null;
                const { syncResult } = await createDriveLog(logData);
                if (syncResult?.updated) {
                    showToast(`다음 기록의 출발 km가 ${syncResult.oldStartKm?.toLocaleString()} → ${syncResult.newStartKm?.toLocaleString()}으로 자동 조정되었습니다.`, 'info');
                }
            }

            // 예약 상태를 completed로 변경
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
                setTimeout(() => setSuccess(false), 3000);
            }
        } catch (err) {
            console.error('운행일지 저장 실패:', err);
            // 중복 저장 에러는 재시도 없이 경고만 표시
            if (err.message?.includes('중복')) {
                showToast(err.message, 'warning');
            } else {
                // 네트워크 에러 시 재시도 버튼 표시
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
        // 상태
        form, setForm,
        vehicles, favorites, members,
        loading, submitting, success,
        selectedPassengers, selectedVehicle,
        isElectric,
        reservationData, continueFrom, isQuickDrive,
        editLog, isEditMode, isRetroactive,
        showFavSave, setShowFavSave,
        favName, setFavName,
        // OCR (서브 훅에서 가져옴)
        ocrLoading: ocr.ocrLoading,
        ocrError: ocr.ocrError,
        ocrSuccess: ocr.ocrSuccess,
        ocrReportSending: ocr.ocrReportSending,
        ocrReportSent: ocr.ocrReportSent,
        cameraInputRef: ocr.cameraInputRef,
        endKmInputRef: ocr.endKmInputRef,
        // 핸들러
        handleVehicleSelect,
        handleFavoriteSelect,
        handleSaveFavorite,
        togglePassenger,
        handleOcrCapture: ocr.handleOcrCapture,
        handleOcrReport: ocr.handleOcrReport,
        handleSubmit,
    };
}
