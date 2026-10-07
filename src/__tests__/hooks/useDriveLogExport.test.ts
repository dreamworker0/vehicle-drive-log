import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * useDriveLogExport — 운행일지 내보내기 기간 검증 테스트.
 * useDriveLogList에서 추출하면서, 기존에 거대 훅에 묻혀 검증되지 않던
 * 기간 유효성(필수/역전/최대 3개월) 로직을 단위 테스트로 고정한다.
 */

const mockShowToast = vi.fn();
vi.mock('../../hooks/useToast', () => ({
    useToast: () => ({ showToast: mockShowToast }),
}));

const mockGetAllDriveLogsForExport = vi.fn();
vi.mock('../../lib/firestore', () => ({
    getAllDriveLogsForExport: (...args: unknown[]) => mockGetAllDriveLogsForExport(...args),
}));

import { useDriveLogExport, EXPORT_OPTIONS_KEY, type ExportFilters } from '../../hooks/driveLogList/useDriveLogExport';
import type { Organization } from '../../types/organization';

const baseFilters: ExportFilters = {
    vehicleId: '',
    driverUid: '',
    search: '',
    startDate: '2026-03-01',
    endDate: '2026-03-31',
};

// 내보내기 훅은 기관명·결재선만 읽지만 파라미터 타입은 Organization이라 필수 필드를 채운다
const testOrg: Organization = {
    id: 'org1',
    name: '테스트기관',
    applicantUid: 'admin1',
    status: 'approved',
};

function setup(filters: Partial<ExportFilters> = {}) {
    return renderHook(() =>
        useDriveLogExport('org1', { ...baseFilters, ...filters }, testOrg),
    );
}

describe('useDriveLogExport', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetAllDriveLogsForExport.mockResolvedValue([]);
    });

    it('기간이 비어 있으면 경고하고 데이터를 불러오지 않는다', async () => {
        const { result } = setup({ startDate: '', endDate: '' });

        await act(async () => {
            result.current.handleExportExcel();
        });

        expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('기간'), 'warning');
        expect(mockGetAllDriveLogsForExport).not.toHaveBeenCalled();
    });

    it('종료일이 시작일보다 앞서면 경고한다', async () => {
        const { result } = setup({ startDate: '2026-03-31', endDate: '2026-03-01' });

        await act(async () => {
            result.current.handleExportExcel();
        });

        expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('앞섭'), 'warning');
        expect(mockGetAllDriveLogsForExport).not.toHaveBeenCalled();
    });

    it('기간이 3개월(92일)을 초과하면 경고한다', async () => {
        const { result } = setup({ startDate: '2026-01-01', endDate: '2026-06-01' });

        await act(async () => {
            result.current.handleExportPdf();
        });

        expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('최대 3개월'), 'warning');
        expect(mockGetAllDriveLogsForExport).not.toHaveBeenCalled();
    });

    it('유효한 기간이면 전체 데이터를 조회한다', async () => {
        const { result } = setup();

        await act(async () => {
            result.current.handleExportExcel();
        });

        expect(mockGetAllDriveLogsForExport).toHaveBeenCalledWith(
            'org1',
            expect.objectContaining({ startDate: '2026-03-01', endDate: '2026-03-31' }),
        );
    });

    it('조회 결과가 없으면 추출할 데이터가 없다고 안내한다', async () => {
        mockGetAllDriveLogsForExport.mockResolvedValueOnce([]);
        const { result } = setup();

        await act(async () => {
            result.current.handleExportExcel();
        });

        expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('추출할 데이터가 없'), 'warning');
    });
});

describe('useDriveLogExport — 내보내기 옵션 기억', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('처음에는 모두 꺼져 있다 — 기본값은 그대로', () => {
        const { result } = setup();
        expect(result.current.includePassengers).toBe(false);
        expect(result.current.includeHipass).toBe(false);
        expect(result.current.includeFuel).toBe(false);
    });

    it('켠 옵션은 다음에 열 때도 켜져 있고, 끄면 다시 꺼진다', () => {
        const first = setup();
        act(() => first.result.current.setIncludePassengers(true));
        act(() => first.result.current.setIncludeFuel(true));
        first.unmount();

        const second = setup();
        expect(second.result.current.includePassengers).toBe(true);
        expect(second.result.current.includeFuel).toBe(true);
        expect(second.result.current.includeHipass).toBe(false);

        act(() => second.result.current.setIncludePassengers(false));
        second.unmount();
        expect(setup().result.current.includePassengers).toBe(false);
    });

    it('저장된 값이 깨져 있으면 꺼진 채로 시작한다', () => {
        localStorage.setItem(EXPORT_OPTIONS_KEY, '{깨짐');
        expect(setup().result.current.includePassengers).toBe(false);
    });
});
