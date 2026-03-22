/**
 * useDailyLog — 일별일지 조회 훅
 * 날짜+차량 기준으로 운행/주유 데이터를 조회하고 요약 계산
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from './useAuth';
import { getVehicles, getOrganization } from '../lib/firestore';
import { getDriveLogsByDate, getFuelLogsByDate, getPreviousDayEndKm } from '../lib/firestore/dailyLogQueries';
import type { Vehicle } from '../types/vehicle';
import type { Organization } from '../types/organization';
import { toLocalDateStr } from '../lib/dateUtils';

interface DailyLogSummary {
    todayDistance: number;       // 금일 운행거리
    previousEndKm: number | null; // 전일 누계
    todayEndKm: number | null;    // 금일 누계
}

export default function useDailyLog() {
    const { userData } = useAuth();
    const orgId = userData?.organizationId;

    const [selectedDate, setSelectedDate] = useState(toLocalDateStr(new Date()));
    const [selectedVehicleId, setSelectedVehicleId] = useState('');
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [org, setOrg] = useState<Organization | null>(null);
    const [driveLogs, setDriveLogs] = useState<Record<string, unknown>[]>([]);
    const [fuelLogs, setFuelLogs] = useState<Record<string, unknown>[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingData, setLoadingData] = useState(false);
    const [previousEndKm, setPreviousEndKm] = useState<number | null>(null);

    // 차량 목록 + 기관 정보 로드
    useEffect(() => {
        if (!orgId) return;
        const fetch = async () => {
            try {
                const [v, orgData] = await Promise.all([
                    getVehicles(orgId),
                    getOrganization(orgId),
                ]);
                // 퇴역하지 않은 차량만 표시
                const active = (v as Vehicle[]).filter(vh => !vh.retired?.isRetired);
                setVehicles(active);
                setOrg(orgData as Organization | null);
                if (active.length > 0 && !selectedVehicleId) {
                    setSelectedVehicleId(active[0].id);
                }
            } catch (err) {
                console.error('초기 데이터 로드 실패:', err);
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps

    // 날짜+차량 변경 시 데이터 조회
    const fetchData = useCallback(async () => {
        if (!orgId || !selectedVehicleId || !selectedDate) return;
        setLoadingData(true);
        try {
            const [drives, fuels, prevKm] = await Promise.all([
                getDriveLogsByDate(orgId, selectedVehicleId, selectedDate),
                getFuelLogsByDate(orgId, selectedVehicleId, selectedDate),
                getPreviousDayEndKm(orgId, selectedVehicleId, selectedDate),
            ]);
            setDriveLogs(drives);
            setFuelLogs(fuels);
            setPreviousEndKm(prevKm);
        } catch (err) {
            console.error('일별 데이터 조회 실패:', err);
        } finally {
            setLoadingData(false);
        }
    }, [orgId, selectedVehicleId, selectedDate]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // 요약 계산
    const summary: DailyLogSummary = useMemo(() => {
        const todayDistance = driveLogs.reduce((sum, log) => {
            const d = ((log.endKm as number) || 0) - ((log.startKm as number) || 0);
            return sum + (d > 0 ? d : 0);
        }, 0);

        const todayEndKm = driveLogs.length > 0
            ? Math.max(...driveLogs.map((log) => (log.endKm as number) || 0))
            : null;

        return { todayDistance, previousEndKm, todayEndKm };
    }, [driveLogs, previousEndKm]);

    // 선택된 차량 정보
    const selectedVehicle = useMemo(
        () => vehicles.find(v => v.id === selectedVehicleId),
        [vehicles, selectedVehicleId],
    );

    return {
        // 상태
        selectedDate, setSelectedDate,
        selectedVehicleId, setSelectedVehicleId,
        vehicles, org, selectedVehicle,
        driveLogs, fuelLogs,
        loading, loadingData,
        summary,
    };
}
