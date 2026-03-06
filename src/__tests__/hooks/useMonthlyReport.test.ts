import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../../hooks/useAuth', () => ({
    useAuth: () => ({
        userData: { organizationId: 'org-1', role: 'admin', name: 'Admin' },
    }),
}));

vi.mock('../../lib/firestore', () => ({
    getDriveLogs: vi.fn().mockResolvedValue({
        docs: [
            {
                date: '2026-01-15',
                driverName: '홍길동',
                vehicleDisplayName: '1호차',
                destination: '서울역',
                departureKm: 1000,
                arrivalKm: 1050,
                startKm: 1000,
                endKm: 1050,
                purpose: '출장',
                startTime: '09:00',
                endTime: '10:00',
            },
        ],
    }),
}));

import useMonthlyReport from '../../hooks/useMonthlyReport';

describe('useMonthlyReport', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('초기 로딩 후 데이터가 로드된다', async () => {
        const { result } = renderHook(() => useMonthlyReport());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
    });

    it('startDate/endDate가 존재한다', async () => {
        const { result } = renderHook(() => useMonthlyReport());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.startDate).toBeDefined();
        expect(result.current.endDate).toBeDefined();
    });

    it('stats 객체가 존재한다', async () => {
        const { result } = renderHook(() => useMonthlyReport());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.stats).toBeDefined();
    });

    it('exportCSV 함수가 존재한다', async () => {
        const { result } = renderHook(() => useMonthlyReport());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(typeof result.current.exportCSV).toBe('function');
    });

    it('activePeriod와 setPeriod가 존재한다', async () => {
        const { result } = renderHook(() => useMonthlyReport());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.activePeriod).toBeDefined();
        expect(typeof result.current.setPeriod).toBe('function');
    });
});
