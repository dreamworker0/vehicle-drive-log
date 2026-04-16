/**
 * useHipassChargeAdmin — 관리자용 하이패스 충전 기록 관리 훅
 * useFuelLogAdmin 패턴 기반
 */
import { useState, useMemo } from 'react';
import { useAuth } from './useAuth';
import type { Vehicle } from '../types/vehicle';
import type { HipassCharge } from '../types/hipassCharge';
import useBaseHipassCharge from './base/useBaseHipassCharge';

export default function useHipassChargeAdmin() {
    const { userData } = useAuth();
    const orgId = userData?.organizationId;

    const { 
        vehicles, 
        records, 
        loading, 
        calculateTotalCharge, 
        handleDeleteBase 
    } = useBaseHipassCharge(orgId ? orgId : undefined, { isAdmin: true });

    const [filters, setFilters] = useState({
        search: '',
        vehicleId: '',
        startDate: '',
        endDate: '',
    });

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
                        r.chargerName?.toLowerCase().includes(s) ||
                        r.cardNumber?.toLowerCase().includes(s)
                    );
                }
                return true;
            });
    }, [records, filters]);

    const totalChargeAmount = useMemo(() => calculateTotalCharge(filteredRecords), [filteredRecords, calculateTotalCharge]);

    // ── 통계 데이터 ──

    /** 월별 충전 추세 (최근 6개월) */
    const monthlyTrend = useMemo(() => {
        const byMonth: Record<string, { amount: number; count: number }> = {};
        records.forEach(r => {
            const month = r.date?.slice(0, 7); // 'YYYY-MM'
            if (!month) return;
            if (!byMonth[month]) byMonth[month] = { amount: 0, count: 0 };
            byMonth[month].amount += r.chargeAmount || 0;
            byMonth[month].count++;
        });
        return Object.entries(byMonth)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .slice(-6)
            .map(([month, data]) => ({ month: month.slice(2), ...data })); // 'YY-MM'
    }, [records]);

    /** 카드별 사용량 집계 */
    const cardStats = useMemo(() => {
        const byCard: Record<string, { amount: number; count: number }> = {};
        records.forEach(r => {
            const card = r.cardNumber || '(미지정)';
            if (!byCard[card]) byCard[card] = { amount: 0, count: 0 };
            byCard[card].amount += r.chargeAmount || 0;
            byCard[card].count++;
        });
        return Object.entries(byCard)
            .sort((a, b) => b[1].amount - a[1].amount)
            .map(([name, data]) => ({ name, ...data }));
    }, [records]);

    /** 차량별 충전 집계 */
    const vehicleStats = useMemo(() => {
        const byVehicle: Record<string, { amount: number; count: number }> = {};
        records.forEach(r => {
            const name = r.vehicleName || '(미지정)';
            if (!byVehicle[name]) byVehicle[name] = { amount: 0, count: 0 };
            byVehicle[name].amount += r.chargeAmount || 0;
            byVehicle[name].count++;
        });
        return Object.entries(byVehicle)
            .sort((a, b) => b[1].amount - a[1].amount)
            .map(([name, data]) => ({ name, ...data }));
    }, [records]);

    const resetFilters = () => setFilters({ search: '', vehicleId: '', startDate: '', endDate: '' });

    const handleDelete = async (rec: HipassCharge) => {
        await handleDeleteBase(rec);
    };

    return {
        vehicles, loading,
        filters, setFilters, resetFilters,
        filteredRecords, totalChargeAmount,
        monthlyTrend, cardStats, vehicleStats,
        handleDelete,
    };
}
