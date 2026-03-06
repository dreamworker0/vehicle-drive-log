/**
 * useMaintenanceLog — 정비 기록 상태 + CRUD 로직
 * MaintenanceLog에서 추출된 커스텀 훅
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from './useAuth';
import { useToast } from './useToast';
import type { Vehicle } from '../types/vehicle';
import type { MaintenanceRecord } from '../types/maintenance';
import { getVehicles, getMaintenanceRecords, createMaintenanceRecord, deleteMaintenanceRecord, clearVehicleMaintenanceBlock, cancelVehicleReservations } from '../lib/firestore';
import { toLocalDateStr } from '../lib/dateUtils';

export const MAINTENANCE_TYPES = [
    { value: 'oil', label: '엔진오일', icon: '🛢️' },
    { value: 'tire', label: '타이어', icon: '🔘' },
    { value: 'brake', label: '브레이크', icon: '🛑' },
    { value: 'battery', label: '배터리', icon: '🔋' },
    { value: 'filter', label: '필터', icon: '🌀' },
    { value: 'wash', label: '세차', icon: '🧽' },
    { value: 'inspection', label: '정기검사', icon: '📋' },
    { value: 'repair', label: '수리', icon: '🔧' },
    { value: 'other', label: '기타', icon: '📌' },
];

const INITIAL_FORM = {
    vehicleId: '', vehicleName: '',
    date: toLocalDateStr(),
    type: 'oil', description: '', cost: '',
    shop: '', km: '', nextDueKm: '', nextDueDate: '',
    blockVehicle: false, blockEndDate: toLocalDateStr(),
};

export default function useMaintenanceLog() {
    const { userData } = useAuth();
    const { showToast } = useToast();
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [records, setRecords] = useState<MaintenanceRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [saving, setSaving] = useState(false);
    const [filterVehicle, setFilterVehicle] = useState('');
    const [form, setForm] = useState(INITIAL_FORM);

    const orgId = userData?.organizationId;

    useEffect(() => {
        if (!orgId) return;
        const fetch = async () => {
            try {
                const [v, r] = await Promise.all([
                    getVehicles(orgId),
                    getMaintenanceRecords(orgId),
                ]);
                setVehicles(v as Vehicle[]);
                setRecords(r as MaintenanceRecord[]);
            } catch (err) {
                console.error('정비 기록 로드 실패:', err);
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, [orgId]);

    const filteredRecords = useMemo(() => {
        const base = filterVehicle ? records.filter(r => r.vehicleId === filterVehicle) : records;
        return base.map(r => {
            const v = vehicles.find(v => v.id === r.vehicleId);
            return { ...r, vehicleType: v?.vehicleType || null };
        });
    }, [records, filterVehicle, vehicles]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.vehicleId || !form.date || !form.type) return;
        setSaving(true);
        try {
            await createMaintenanceRecord({
                organizationId: orgId,
                vehicleId: form.vehicleId,
                vehicleName: form.vehicleName,
                date: form.date,
                type: form.type,
                description: form.description.trim(),
                cost: form.cost ? parseInt(form.cost) : null,
                shop: form.shop.trim(),
                km: form.km ? parseInt(form.km) : null,
                nextDueKm: form.nextDueKm ? parseInt(form.nextDueKm) : null,
                nextDueDate: form.nextDueDate || null,
                blockVehicle: form.blockVehicle,
                blockEndDate: form.blockEndDate || null,
            });
            // 차단 설정 시 기존 예약 자동 취소 + 차량 목록 새로고침
            let cancelledCount = 0;
            if (form.blockVehicle) {
                const typeInfo = MAINTENANCE_TYPES.find((t) => t.value === form.type);
                cancelledCount = await cancelVehicleReservations(
                    orgId!, form.vehicleId, form.vehicleName,
                    form.date, form.blockEndDate || null,
                    typeInfo?.label || '정비'
                );
                const v = await getVehicles(orgId!);
                setVehicles(v as Vehicle[]);
            }
            const updated = await getMaintenanceRecords(orgId!);
            setRecords(updated as MaintenanceRecord[]);
            setShowForm(false);
            setForm(INITIAL_FORM);
            showToast(
                form.blockVehicle
                    ? `정비 기록 저장 + 차량 차단 완료${cancelledCount > 0 ? ` (예약 ${cancelledCount}건 자동 취소)` : ''}`
                    : '정비 기록이 저장되었습니다.',
                'success'
            );
        } catch (err) {
            console.error('정비 기록 저장 실패:', err);
            showToast('저장에 실패했습니다.', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (rec: MaintenanceRecord) => {
        if (!confirm('이 정비 기록을 삭제하시겠습니까?')) return;
        try {
            await deleteMaintenanceRecord(rec.id, rec.blockVehicle ? rec.vehicleId : null);
            setRecords(prev => prev.filter(r => r.id !== rec.id));
            // 차단 연결 기록 삭제 시 차량 목록 새로고침
            if (rec.blockVehicle) {
                const v = await getVehicles(orgId!);
                setVehicles(v);
            }
        } catch (err) {
            console.error('삭제 실패:', err);
        }
    };

    const handleClearBlock = async (vehicleId: string) => {
        if (!confirm('이 차량의 정비 차단을 해제하시겠습니까?')) return;
        try {
            await clearVehicleMaintenanceBlock(vehicleId);
            const v = await getVehicles(orgId!);
            setVehicles(v);
            showToast('차량 차단이 해제되었습니다.', 'success');
        } catch (err) {
            console.error('차단 해제 실패:', err);
            showToast('차단 해제에 실패했습니다.', 'error');
        }
    };

    const getTypeInfo = (type: string) => MAINTENANCE_TYPES.find(t => t.value === type) || MAINTENANCE_TYPES[MAINTENANCE_TYPES.length - 1];

    const handleVehicleSelect = (vehicleId: string) => {
        const v = vehicles.find(v => v.id === vehicleId);
        setForm({ ...form, vehicleId, vehicleName: v?.displayName || '' });
    };

    return {
        vehicles, loading, showForm, setShowForm,
        saving, filterVehicle, setFilterVehicle,
        form, setForm, filteredRecords,
        handleSubmit, handleDelete, getTypeInfo, handleVehicleSelect,
        handleClearBlock,
    };
}
