/**
 * useFuelLog — 주유 기록 상태 + CRUD 로직
 * 직원 화면에서 사용하는 커스텀 훅
 */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAuth } from './useAuth';
import { useToast } from './useToast';
import { useConfirm } from './useConfirm';
import type { Vehicle } from '../types/vehicle';
import type { FuelLog } from '../types/fuelLog';
import { getVehicles, getFuelLogs, createFuelLog, deleteFuelLog, updateFuelLog, getTodayReservations } from '../lib/firestore';
import { toLocalDateStr } from '../lib/dateUtils';
import { ocrDashboard } from '../lib/ocr';

const INITIAL_FORM = {
    vehicleId: '',
    vehicleName: '',
    date: toLocalDateStr(),
    meterReading: '',
    fuelAmount: '',
    fuelCost: '',
    notes: '',
};

export default function useFuelLog() {
    const { user, userData } = useAuth();
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [records, setRecords] = useState<FuelLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState(INITIAL_FORM);

    // 수정 모드
    const [editingId, setEditingId] = useState<string | null>(null);

    // OCR 관련 상태
    const [ocrLoading, setOcrLoading] = useState(false);
    const [ocrError, setOcrError] = useState('');
    const [ocrSuccess, setOcrSuccess] = useState(false);
    const [ocrImageUrl, setOcrImageUrl] = useState<string | null>(null);
    const cameraInputRef = useRef<HTMLInputElement>(null);

    const orgId = userData?.organizationId;
    const todayStr = toLocalDateStr();

    useEffect(() => {
        if (!orgId) { setLoading(false); return; }
        const fetchData = async () => {
            // 차량 목록은 반드시 로드 (다른 쿼리 실패해도 차량 카드 표시)
            try {
                const v = await getVehicles(orgId);
                setVehicles(v as Vehicle[]);

                // 운행 중 차량 자동 선택
                try {
                    const todayRes = await getTodayReservations(orgId, todayStr);
                    const activeRes = (todayRes as { reservedByUid?: string; status?: string; vehicleId?: string }[]).find(
                        res => res.reservedByUid === user?.uid && res.status === 'in_progress'
                    );
                    if (activeRes) {
                        const activeVehicle = (v as Vehicle[]).find(vh => vh.id === activeRes.vehicleId);
                        if (activeVehicle) {
                            setForm(prev => ({
                                ...prev,
                                vehicleId: activeVehicle.id,
                                vehicleName: activeVehicle.displayName || activeVehicle.name || '',
                            }));
                        }
                    }
                } catch (err) {
                    console.warn('오늘 예약 로드 실패 (무시):', err);
                }
            } catch (err) {
                console.error('차량 목록 로드 실패:', err);
            }

            // 주유 기록 로드 (인덱스 빌드 중이면 빈 배열로 처리)
            try {
                const r = await getFuelLogs(orgId);
                setRecords(r as FuelLog[]);
            } catch (err) {
                console.warn('주유 기록 로드 실패 (인덱스 빌드 중일 수 있음):', err);
                setRecords([]);
            }

            setLoading(false);
        };
        fetchData();
    }, [orgId, todayStr, user?.uid]);

    // 기록에 차량 아이콘 정보 병합
    const enrichedRecords = useMemo(() => {
        return records.map(r => {
            const v = vehicles.find(v => v.id === r.vehicleId);
            return { ...r, vehicleType: v?.vehicleType || null };
        });
    }, [records, vehicles]);

    // 합계 계산
    const totalCost = useMemo(() => records.reduce((sum, r) => sum + (r.fuelCost || 0), 0), [records]);
    const totalAmount = useMemo(() => records.reduce((sum, r) => sum + (r.fuelAmount || 0), 0), [records]);

    // 선택된 차량의 현재 누적 km
    const selectedVehicleKm = useMemo(() => {
        if (!form.vehicleId) return 0;
        const v = vehicles.find(v => v.id === form.vehicleId);
        return v?.currentKm || 0;
    }, [form.vehicleId, vehicles]);

    // 선택된 차량이 전기차인지 여부
    const isElectric = useMemo(() => {
        if (!form.vehicleId) return false;
        const v = vehicles.find(v => v.id === form.vehicleId);
        return v?.fuelType === 'electric';
    }, [form.vehicleId, vehicles]);

    const handleVehicleSelect = (vehicleId: string) => {
        const v = vehicles.find(v => v.id === vehicleId);
        setForm({ ...form, vehicleId, vehicleName: v?.displayName || '' });
    };

    // 기록 클릭 → 수정 모드
    const handleEdit = (rec: FuelLog) => {
        // 본인 기록만 수정 가능
        if (rec.driverUid !== user?.uid) {
            showToast('본인의 주유 기록만 수정할 수 있습니다.', 'warning');
            return;
        }
        setEditingId(rec.id);
        setForm({
            vehicleId: rec.vehicleId,
            vehicleName: rec.vehicleName || '',
            date: rec.date,
            meterReading: String(rec.meterReading || ''),
            fuelAmount: String(rec.fuelAmount || ''),
            fuelCost: String(rec.fuelCost || ''),
            notes: rec.notes || '',
        });
        setShowForm(true);
    };

    // 수정 취소
    const handleCancelEdit = () => {
        setEditingId(null);
        setForm(INITIAL_FORM);
        setShowForm(false);
    };

    // 주유미터 OCR 촬영
    const handleOcrCapture = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setOcrLoading(true);
        setOcrError('');
        setOcrSuccess(false);
        setOcrImageUrl(null);

        try {
            const base64 = await new Promise((resolve, reject) => {
                const img = new Image();
                const objectUrl = URL.createObjectURL(file);
                img.onload = () => {
                    URL.revokeObjectURL(objectUrl);
                    const MAX = 1024;
                    const scale = Math.min(1, MAX / Math.max(img.width, img.height));
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.round(img.width * scale);
                    canvas.height = Math.round(img.height * scale);
                    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.80);
                    const base64Data = dataUrl.split(',')[1];
                    setOcrImageUrl(base64Data);
                    resolve(base64Data);
                };
                img.onerror = reject;
                img.src = objectUrl;
            });

            const result = await ocrDashboard(base64 as string, 'image/jpeg', false) as { km: number | null; raw: string };

            if (result.km != null) {
                setForm(prev => ({ ...prev, meterReading: result.km!.toString() }));
                setOcrSuccess(true);
            } else {
                setOcrError('계기판에서 숫자를 인식하지 못했습니다. 직접 입력해주세요.');
            }
        } catch (err) {
            console.error('계기판 OCR 실패:', err);
            setOcrError('계기판 인식에 실패했습니다.');
        } finally {
            setOcrLoading(false);
            if (cameraInputRef.current) cameraInputRef.current.value = '';
        }
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.vehicleId || !form.date || !form.meterReading || !form.fuelAmount || !form.fuelCost) {
            showToast('모든 필수 항목을 입력해주세요.', 'warning');
            return;
        }

        // 주유미터가 차량의 현재 누적 km보다 작으면 경고
        const meter = parseInt(form.meterReading);
        if (selectedVehicleKm > 0 && meter < selectedVehicleKm) {
            const ok = await confirm({
                message: `입력한 주유미터(${meter.toLocaleString()} km)가 차량의 현재 누적 km(${selectedVehicleKm.toLocaleString()} km)보다 작습니다. 그래도 저장하시겠습니까?`,
                confirmColor: 'warning',
            });
            if (!ok) return;
        }
        setSaving(true);
        try {
            const payload = {
                organizationId: orgId,
                vehicleId: form.vehicleId,
                vehicleName: form.vehicleName,
                driverUid: user?.uid,
                driverName: userData?.name || user?.displayName || '',
                date: form.date,
                meterReading: parseInt(form.meterReading),
                fuelType: isElectric ? 'electric' as const : 'gasoline' as const,
                fuelAmount: parseFloat(form.fuelAmount),
                fuelCost: parseInt(form.fuelCost),
                notes: form.notes.trim() || '',
            };

            if (editingId) {
                // 수정
                await updateFuelLog(editingId, payload);
                showToast('주유 기록이 수정되었습니다.', 'success');
            } else {
                // 새로 생성
                await createFuelLog(payload);
                showToast('주유 기록이 저장되었습니다.', 'success');
            }

            const updated = await getFuelLogs(orgId!);
            setRecords(updated as FuelLog[]);
            setShowForm(false);
            setEditingId(null);
            setForm(INITIAL_FORM);
        } catch (err) {
            console.error('주유 기록 저장 실패:', err);
            showToast('저장에 실패했습니다.', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (rec: FuelLog) => {
        // 본인 기록만 삭제 가능
        if (rec.driverUid !== user?.uid) {
            showToast('본인의 주유 기록만 삭제할 수 있습니다.', 'warning');
            return;
        }
        if (!await confirm({ message: '이 주유 기록을 삭제하시겠습니까?', confirmColor: 'danger' })) return;
        try {
            await deleteFuelLog(rec.id);
            setRecords(prev => prev.filter(r => r.id !== rec.id));
            showToast('주유 기록이 삭제되었습니다.', 'success');
        } catch (err) {
            console.error('삭제 실패:', err);
            showToast('삭제에 실패했습니다.', 'error');
        }
    };

    return {
        vehicles, loading, showForm, setShowForm,
        saving, form, setForm, enrichedRecords,
        totalCost, totalAmount, selectedVehicleKm,
        isElectric,
        editingId, handleEdit, handleCancelEdit,
        handleSubmit, handleDelete, handleVehicleSelect,
        currentUid: user?.uid,
        // OCR
        ocrLoading, ocrError, ocrSuccess, ocrImageUrl, cameraInputRef, handleOcrCapture,
    };
}
