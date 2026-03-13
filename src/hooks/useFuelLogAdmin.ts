/**
 * useFuelLogAdmin — 관리자용 주유 기록 관리 훅
 * FuelLogManager에서 사용하는 커스텀 훅
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from './useAuth';
import { useToast } from './useToast';
import { useConfirm } from '../contexts/ConfirmContext';
import type { Vehicle } from '../types/vehicle';
import type { FuelLog } from '../types/fuelLog';
import { getVehicles, getFuelLogs, deleteFuelLog } from '../lib/firestore';

export default function useFuelLogAdmin() {
    const { userData } = useAuth();
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [records, setRecords] = useState<FuelLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [filters, setFilters] = useState({
        search: '',
        vehicleId: '',
        startDate: '',
        endDate: '',
    });

    const orgId = userData?.organizationId;

    useEffect(() => {
        if (!orgId) { setLoading(false); return; }
        const fetch = async () => {
            try {
                const [v, r] = await Promise.all([
                    getVehicles(orgId),
                    getFuelLogs(orgId),
                ]);
                setVehicles(v as Vehicle[]);
                setRecords(r as FuelLog[]);
            } catch (err) {
                console.error('주유 기록 로드 실패:', err);
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, [orgId]);

    const filteredRecords = useMemo(() => {
        return records
            .filter(r => {
                if (filters.vehicleId && r.vehicleId !== filters.vehicleId) return false;
                if (filters.startDate && r.date < filters.startDate) return false;
                if (filters.endDate && r.date > filters.endDate) return false;
                if (filters.search) {
                    const s = filters.search.toLowerCase();
                    return (
                        r.vehicleName?.toLowerCase().includes(s) ||
                        r.driverName?.toLowerCase().includes(s)
                    );
                }
                return true;
            })
            .map(r => {
                const v = vehicles.find(v => v.id === r.vehicleId);
                return { ...r, vehicleType: v?.vehicleType || null };
            });
    }, [records, filters, vehicles]);

    const totalCost = useMemo(() => filteredRecords.reduce((sum, r) => sum + (r.fuelCost || 0), 0), [filteredRecords]);
    const totalAmount = useMemo(() => filteredRecords.reduce((sum, r) => sum + (r.fuelAmount || 0), 0), [filteredRecords]);

    const resetFilters = () => setFilters({ search: '', vehicleId: '', startDate: '', endDate: '' });

    const handleDelete = async (rec: FuelLog) => {
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
        vehicles, loading,
        filters, setFilters, resetFilters,
        filteredRecords, totalCost, totalAmount,
        handleDelete,
    };
}
