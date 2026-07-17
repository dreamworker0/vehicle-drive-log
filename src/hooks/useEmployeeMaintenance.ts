/**
 * useEmployeeMaintenance — 직원용 차량 수리·정비 기록 상태 + CRUD 로직
 * useFuelLog 구조를 따른다. 차량 차단(blockVehicle)은 관리자 전용이므로 직원은 사용하지 않는다.
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from './useAuth';
import { useToast } from './useToast';
import { useConfirm } from './useConfirm';
import type { Vehicle } from '../types/vehicle';
import type { MaintenanceRecord } from '../types/maintenance';
import { getVehicles, getMaintenanceRecords, createMaintenanceRecord, updateMaintenanceRecord, deleteMaintenanceRecord } from '../lib/firestore';
import { toLocalDateStr } from '../lib/dateUtils';

const INITIAL_FORM = {
    vehicleId: '', vehicleName: '',
    date: toLocalDateStr(),
    type: 'repair', description: '', cost: '',
    shop: '', km: '',
};

export default function useEmployeeMaintenance() {
    const { user, userData } = useAuth();
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [records, setRecords] = useState<MaintenanceRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState(INITIAL_FORM);

    const orgId = userData?.organizationId;
    const currentUid = user?.uid;

    useEffect(() => {
        if (!orgId) { setLoading(false); return; }
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

    // 기록에 차량 아이콘 정보 병합
    const enrichedRecords = useMemo(() => {
        return records.map(r => {
            const v = vehicles.find(v => v.id === r.vehicleId);
            return { ...r, vehicleType: v?.vehicleType || null };
        });
    }, [records, vehicles]);

    const handleVehicleSelect = (vehicleId: string) => {
        const v = vehicles.find(v => v.id === vehicleId);
        setForm({ ...form, vehicleId, vehicleName: v?.displayName || '' });
    };

    const handleEdit = (rec: MaintenanceRecord) => {
        // 본인 작성 기록만 수정 가능
        if (rec.createdByUid !== currentUid) {
            showToast('본인이 작성한 기록만 수정할 수 있습니다.', 'warning');
            return;
        }
        setForm({
            vehicleId: rec.vehicleId,
            vehicleName: rec.vehicleName || '',
            date: rec.date,
            type: rec.type,
            description: rec.description || '',
            cost: rec.cost ? String(rec.cost) : '',
            shop: rec.shop || '',
            km: rec.km ? String(rec.km) : '',
        });
        setEditingId(rec.id);
        setShowForm(true);
    };

    const handleCancelEdit = () => {
        setForm(INITIAL_FORM);
        setEditingId(null);
        setShowForm(false);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.vehicleId || !form.date || !form.type) {
            showToast('차량ㆍ날짜ㆍ유형은 필수입니다.', 'warning');
            return;
        }
        setSaving(true);
        try {
            const payload = {
                organizationId: orgId,
                vehicleId: form.vehicleId,
                vehicleName: form.vehicleName,
                date: form.date,
                type: form.type,
                description: form.description.trim(),
                cost: form.cost ? parseInt(String(form.cost)) : null,
                shop: form.shop.trim(),
                km: form.km ? parseInt(String(form.km)) : null,
                createdByUid: currentUid,
                createdByName: userData?.name || user?.displayName || '',
                // 차량 차단은 관리자 전용 — 직원은 항상 false
                blockVehicle: false,
            };

            if (editingId) {
                await updateMaintenanceRecord(editingId, payload);
                showToast('정비 기록이 수정되었습니다.', 'success');
            } else {
                await createMaintenanceRecord(payload);
                showToast('정비 기록이 저장되었습니다.', 'success');
            }

            const updated = await getMaintenanceRecords(orgId!);
            setRecords(updated as MaintenanceRecord[]);
            setShowForm(false);
            setEditingId(null);
            setForm(INITIAL_FORM);
        } catch (err) {
            console.error('정비 기록 저장 실패:', err);
            showToast('저장에 실패했습니다.', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (rec: MaintenanceRecord) => {
        if (rec.createdByUid !== currentUid) {
            showToast('본인이 작성한 기록만 삭제할 수 있습니다.', 'warning');
            return;
        }
        if (!await confirm({ message: '이 정비 기록을 삭제하시겠습니까?', confirmColor: 'danger' })) return;
        try {
            // 직원 기록은 차량 차단과 무관하므로 vehicleId 전달 불필요
            await deleteMaintenanceRecord(rec.id);
            setRecords(prev => prev.filter(r => r.id !== rec.id));
        } catch (err) {
            console.error('삭제 실패:', err);
            showToast('삭제에 실패했습니다.', 'error');
        }
    };

    return {
        vehicles, loading, showForm, setShowForm,
        saving, form, setForm, enrichedRecords,
        editingId, handleEdit, handleCancelEdit,
        handleSubmit, handleDelete, handleVehicleSelect,
        currentUid,
    };
}
