import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

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
    getFuelLogs: vi.fn().mockResolvedValue([]),
    getAllHipassCharges: vi.fn().mockResolvedValue([]),
}));

// 운행일지는 끝까지 읽는다(예전 limit 500은 조용히 잘렸다) — 내보내기와 같은 조회를 쓴다
const mockGetAll = vi.fn();
vi.mock('../../lib/firestore/driveLogs/queries', () => ({
    getAllDriveLogsForExport: (...args: unknown[]) => mockGetAll(...args),
}));

const mockRecordExport = vi.fn();
vi.mock('../../lib/audit/recordExport', () => ({
    recordExport: (...args: unknown[]) => mockRecordExport(...args),
}));

const mockWriteFile = vi.fn();
vi.mock('xlsx', () => ({
    utils: { aoa_to_sheet: () => ({}), book_new: () => ({}), book_append_sheet: vi.fn() },
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

import useMonthlyReport from '../../hooks/useMonthlyReport';

describe('useMonthlyReport', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetAll.mockResolvedValue([
            {
                timestamp: new Date(),
                driverName: '홍길동',
                vehicleDisplayName: '1호차',
                startKm: 1000,
                endKm: 1050,
                purpose: '출장',
                startTime: '09:00',
            },
        ]);
    });

    it('선택 기간과 비교 구간을 함께, 끝까지 읽는다', async () => {
        const { result } = renderHook(() => useMonthlyReport());
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(mockGetAll).toHaveBeenCalledWith('org-1', {
            startDate: result.current.comparePeriod.start,
            endDate: result.current.endDate,
        });
        expect(result.current.filteredLogs).toHaveLength(1);
        expect(result.current.loadError).toBeNull();
    });

    it('상한을 넘으면 잘린 숫자 대신 안내를 보여 준다', async () => {
        mockGetAll.mockRejectedValueOnce(new Error('기간 내 운행일지가 5000건을 초과합니다. 기간을 좁혀 다시 시도해 주세요.'));
        const { result } = renderHook(() => useMonthlyReport());
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.loadError).toContain('5000건을 초과');
        expect(result.current.filteredLogs).toHaveLength(0);
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

    it('exportExcel 함수가 존재한다', async () => {
        const { result } = renderHook(() => useMonthlyReport());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(typeof result.current.exportExcel).toBe('function');
    });

    // 회귀 방지(2026-10-14 감사): 다른 내보내기 경로는 모두 반출을 기록하는데 이 화면만 빠져 있었다.
    it('엑셀을 내려받으면 반출 건수를 접속기록에 남긴다', async () => {
        const { result } = renderHook(() => useMonthlyReport());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => { await result.current.exportExcel(); });

        expect(mockWriteFile).toHaveBeenCalledTimes(1);
        expect(mockRecordExport).toHaveBeenCalledWith('excel', 'driveLogs', result.current.filteredLogs.length);
    });

    it('PDF로 인쇄하면 반출을 접속기록에 남긴다', async () => {
        const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
        const { result } = renderHook(() => useMonthlyReport());
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => { result.current.exportPdf(); });

        expect(printSpy).toHaveBeenCalledTimes(1);
        expect(mockRecordExport).toHaveBeenCalledWith('pdf', 'driveLogs', result.current.filteredLogs.length);
        printSpy.mockRestore();
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
