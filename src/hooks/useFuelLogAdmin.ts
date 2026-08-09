/**
 * useFuelLogAdmin — 관리자용 주유 기록 관리 훅
 * FuelLogManager에서 사용하는 커스텀 훅
 *
 * 로드·삭제·합산은 useBaseFuelLog가 담당하고, 이 훅은 관리자 화면의 필터링만 얹는다.
 * (useHipassChargeAdmin ↔ useBaseHipassCharge와 같은 구조다. base 훅의 주석은 처음부터
 *  "일반 직원 훅과 관리자 훅에서 공통으로 사용"이라고 밝히고 있었지만 실제로는 직원 훅만
 *  쓰고 있어, 관리자 쪽이 같은 로드·삭제 로직을 따로 구현해 두 벌로 갈라져 있었다.)
 */
import { useState, useMemo } from 'react';
import { useAuth } from './useAuth';
import type { FuelLog } from '../types/fuelLog';
import useBaseFuelLog from './base/useBaseFuelLog';

export default function useFuelLogAdmin() {
    const { userData } = useAuth();
    const orgId = userData?.organizationId;

    // organizationId는 기관 미소속 시 null이므로 undefined로 좁혀 넘긴다(base 훅이 스킵 처리).
    const { vehicles, records, loading, calculateStats, handleDeleteBase } = useBaseFuelLog(orgId ?? undefined);

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
                        r.driverName?.toLowerCase().includes(s)
                    );
                }
                return true;
            })
            .map(r => {
                const v = vehicles.find(v => v.id === r.vehicleId);
                return {
                    ...r,
                    vehicleType: v?.vehicleType || null,
                    fuelType: (r.fuelType || v?.fuelType || 'gasoline') as 'gasoline' | 'electric',
                };
            });
    }, [records, filters, vehicles]);

    // 합계는 필터링된 목록 기준이다 — 화면에 보이는 것과 숫자가 어긋나면 안 된다.
    const { cost: totalCost, amount: totalAmount } = useMemo(
        () => calculateStats(filteredRecords),
        [filteredRecords, calculateStats],
    );

    const resetFilters = () => setFilters({ search: '', vehicleId: '', startDate: '', endDate: '' });

    // 관리자는 기관 전체 기록을 삭제할 수 있으므로 본인 확인(checkingUid)을 넘기지 않는다.
    const handleDelete = (rec: FuelLog) => handleDeleteBase(rec);

    return {
        vehicles, loading,
        filters, setFilters, resetFilters,
        filteredRecords, totalCost, totalAmount,
        handleDelete,
    };
}
