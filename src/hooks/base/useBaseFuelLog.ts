import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Vehicle } from '../../types/vehicle';
import type { FuelLog } from '../../types/fuelLog';
import { getVehicles, getFuelLogs, deleteFuelLog } from '../../lib/firestore';
import { useConfirm } from '../useConfirm';
import { useToast } from '../useToast';

/**
 * useBaseFuelLog
 * 주유 기록과 차량 목록을 로드하고, 비용 합산 및 삭제 기능(CRUD 기본 파트)을 제공하는 Base Hook.
 * 일반 직원 훅과 관리자 훅에서 공통으로 사용합니다.
 */
export default function useBaseFuelLog(orgId: string | undefined) {
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [records, setRecords] = useState<FuelLog[]>([]);
    const [loading, setLoading] = useState(true);

    const { confirm } = useConfirm();
    const { showToast } = useToast();

    useEffect(() => {
        if (!orgId) {
            setLoading(false);
            return;
        }

        let isMounted = true;
        setLoading(true);

        const fetchAll = async () => {
            try {
                // 차량 목록과 주유 기록 병렬 로드
                const [vReq, rReq] = await Promise.allSettled([
                    getVehicles(orgId),
                    getFuelLogs(orgId)
                ]);

                if (isMounted) {
                    if (vReq.status === 'fulfilled') {
                        setVehicles(vReq.value as Vehicle[]);
                    } else {
                        console.error('차량 목록 로드 실패:', vReq.reason);
                    }

                    if (rReq.status === 'fulfilled') {
                        setRecords(rReq.value as FuelLog[]);
                    } else {
                        console.warn('주유 기록 로드 실패 (인덱스 빌드 중일 수 있음):', rReq.reason);
                        setRecords([]);
                    }
                }
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        fetchAll();

        return () => { isMounted = false; };
    }, [orgId]);

    // 공통 헬퍼: 삭제 요청
    const handleDeleteBase = useCallback(async (
        rec: FuelLog,
        checkingUid?: string,
        onSuccess?: () => void
    ) => {
        // 본인 소유 확인 로직이 필요하다면 체크 (관리자 로직은 checkingUid를 넘기지 않음)
        if (checkingUid && rec.driverUid !== checkingUid) {
            showToast('본인의 주유 기록만 삭제할 수 있습니다.', 'warning');
            return;
        }

        if (!await confirm({ message: '이 주유 기록을 삭제하시겠습니까?', confirmColor: 'danger' })) return;

        try {
            await deleteFuelLog(rec.id);
            setRecords(prev => prev.filter(r => r.id !== rec.id));
            showToast('주유 기록이 삭제되었습니다.', 'success');
            onSuccess?.();
            return true;
        } catch (err) {
            console.error('삭제 실패:', err);
            showToast('삭제에 실패했습니다.', 'error');
            return false;
        }
    }, [confirm, showToast]);

    // 전체 혹은 전달받은 기록에 대한 합산 유틸리티
    const calculateStats = useCallback((targetRecords: FuelLog[]) => {
        const cost = targetRecords.reduce((sum, r) => sum + (r.fuelCost || 0), 0);
        const amount = targetRecords.reduce((sum, r) => sum + (r.fuelAmount || 0), 0);
        return { cost, amount };
    }, []);

    // 전체 리스트 기준 합계 (관리자 기본 혹은 필터 안 된 경우 유용)
    const totalStats = useMemo(() => calculateStats(records), [records, calculateStats]);

    return {
        vehicles, setVehicles,
        records, setRecords,
        loading,
        totalCost: totalStats.cost,
        totalAmount: totalStats.amount,
        calculateStats,
        handleDeleteBase,
    };
}
