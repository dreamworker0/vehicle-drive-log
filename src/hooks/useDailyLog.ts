/**
 * useDailyLog — 일별일지 조회 훅
 * 날짜+차량 기준으로 운행/주유 데이터를 조회하고 요약 계산
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from './useAuth';
import { getVehicles, getOrganization } from '../lib/firestore';
import { captureError } from '../lib/sentry';
import { getDriveLogsByDate, getFuelLogsByDate, getPreviousDayEndKm } from '../lib/firestore/dailyLogQueries';
import type { Vehicle } from '../types/vehicle';
import type { Organization } from '../types/organization';
import type { DriveLog } from '../types/driveLog';
import type { FuelLog } from '../types/fuelLog';
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
    const [driveLogs, setDriveLogs] = useState<DriveLog[]>([]);
    const [fuelLogs, setFuelLogs] = useState<FuelLog[]>([]);
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
                // 이전 선택이 이 기관 차량이 아니면 첫 차량으로 바꾼다. 예전에는 효과가 처음 캡처한
                // selectedVehicleId를 봐서(린트 억제), 기관이 바뀌어도 다른 기관 차량 id가 남았다.
                if (active.length > 0) {
                    setSelectedVehicleId(prev => (prev && active.some(vh => vh.id === prev)) ? prev : active[0].id);
                }
            } catch (err) {
                captureError(err, { context: 'useDailyLog.loadInitial', orgId });
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, [orgId]);

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
            captureError(err, { context: 'useDailyLog.loadDaily', orgId, vehicleId: selectedVehicleId, date: selectedDate });
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
