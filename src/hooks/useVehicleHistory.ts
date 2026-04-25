/**
 * useVehicleHistory — 차량 이용 내역 상태 관리 + 비즈니스 로직
 * VehicleHistory에서 추출된 커스텀 훅
 */
import { useState, useEffect, useRef } from 'react';
import { useAuth } from './useAuth';
import { getVehicles, getVehicleDriveLogs } from '../lib/firestore';
import type { Vehicle } from '../types/vehicle';
import type { DriveLog } from '../types/driveLog';

const PERIOD_OPTIONS = [
    { label: '1주일', days: 7 },
    { label: '2주일', days: 14 },
    { label: '1개월', days: 30 },
];

export default function useVehicleHistory() {
    const { userData } = useAuth();
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [selectedVehicleId, setSelectedVehicleId] = useState('');
    const [logs, setLogs] = useState<DriveLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [logsLoading, setLogsLoading] = useState(false);
    const [period, setPeriod] = useState(30);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const orgId = userData?.organizationId;

    /* 드롭다운 외부 클릭 감지 */
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (!orgId) {
             
            setLoading(false);
            return;
        }
        const fetch = async () => {
            try {
                const v = await getVehicles(orgId);
                setVehicles(v as Vehicle[]);
                if (v.length > 0) setSelectedVehicleId(v[0].id);
            } catch (err) {
                console.error('차량 로드 실패:', err);
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, [orgId]);

    useEffect(() => {
        if (!selectedVehicleId) return;
        const fetchLogs = async () => {
            setLogsLoading(true);
            try {
                const since = new Date();
                since.setDate(since.getDate() - period);
                // 서버 사이드 기간 필터링 (Firestore where 조건)
                const allLogs = await getVehicleDriveLogs(selectedVehicleId, since);
                setLogs(
                    (allLogs as DriveLog[]).sort((a, b) => {
                        const getTime = (ts: unknown): number => {
                            if (ts && typeof ts === 'object' && 'toDate' in ts && typeof (ts as { toDate?: unknown }).toDate === 'function') return (ts as { toDate: () => Date }).toDate().getTime();
                            if (ts instanceof Date) return ts.getTime();
                            return 0;
                        };
                        return getTime(b.timestamp) - getTime(a.timestamp);
                    })
                );
            } catch (err) {
                console.error('이용 내역 로드 실패:', err);
            } finally {
                setLogsLoading(false);
            }
        };
        fetchLogs();
    }, [selectedVehicleId, period]);

    const selectedVehicle = vehicles.find(v => v.id === selectedVehicleId);
    const totalDistance = logs.reduce((sum, l) => sum + ((l.endKm - l.startKm) || 0), 0);

    const handleSelectVehicle = (id: string) => {
        setSelectedVehicleId(id);
        setDropdownOpen(false);
    };

    return {
        vehicles, selectedVehicleId, selectedVehicle, logs,
        loading, logsLoading, totalDistance,
        period, setPeriod, dropdownOpen, setDropdownOpen, dropdownRef,
        handleSelectVehicle,
        PERIOD_OPTIONS,
    };
}
