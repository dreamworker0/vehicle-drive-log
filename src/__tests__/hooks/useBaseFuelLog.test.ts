import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { FuelLog } from '../../types/fuelLog';

/**
 * useBaseFuelLog — 직원·관리자 주유 훅이 공유하는 로드·합계·삭제 기반 훅.
 * 고정하는 계약: 기관 ID로만 조회한다, 한쪽 로드 실패가 다른 쪽을 막지 않는다,
 * 본인 확인(checkingUid)·확인창 거절이면 삭제하지 않는다, 합계는 빈 값을 0으로 본다.
 */
const mockShowToast = vi.fn();
const mockConfirm = vi.fn();
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => ({ confirm: mockConfirm }) }));

const mockGetVehicles = vi.fn();
const mockGetFuelLogs = vi.fn();
const mockDeleteFuelLog = vi.fn();
vi.mock('../../lib/firestore', () => ({
    getVehicles: (...a: unknown[]) => mockGetVehicles(...a),
    getFuelLogs: (...a: unknown[]) => mockGetFuelLogs(...a),
    deleteFuelLog: (...a: unknown[]) => mockDeleteFuelLog(...a),
}));

import useBaseFuelLog from '../../hooks/base/useBaseFuelLog';

const VEHICLES = [{ id: 'v1', displayName: '쏘나타' }];
const RECORDS = [
    { id: 'r1', driverUid: 'emp-1', fuelCost: 50000, fuelAmount: 30.5 },
    { id: 'r2', driverUid: 'emp-2', fuelCost: 20000, fuelAmount: 10 },
    { id: 'r3', driverUid: 'emp-1' }, // 금액·양을 비워 둔 기록
] as unknown as FuelLog[];

async function renderReady(orgId: string | undefined) {
    const hook = renderHook(() => useBaseFuelLog(orgId));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    return hook;
}

describe('useBaseFuelLog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetVehicles.mockResolvedValue(VEHICLES);
        mockGetFuelLogs.mockResolvedValue(RECORDS);
        mockDeleteFuelLog.mockResolvedValue(undefined);
        mockConfirm.mockResolvedValue(true);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    describe('초기 로드', () => {
        it('기관 ID로 차량·주유 기록을 함께 불러온다', async () => {
            const { result } = await renderReady('org-A');

            expect(mockGetVehicles).toHaveBeenCalledWith('org-A');
            expect(mockGetFuelLogs).toHaveBeenCalledWith('org-A');
            expect(result.current.vehicles).toEqual(VEHICLES);
            expect(result.current.records).toEqual(RECORDS);
        });

        it('기관 ID가 없으면 조회하지 않고 로딩을 끝낸다', async () => {
            const { result } = await renderReady(undefined);

            expect(mockGetVehicles).not.toHaveBeenCalled();
            expect(mockGetFuelLogs).not.toHaveBeenCalled();
            expect(result.current.records).toEqual([]);
        });

        it('주유 기록 조회가 실패해도(인덱스 빌드 중) 차량 목록은 보여 준다', async () => {
            mockGetFuelLogs.mockRejectedValue(new Error('FAILED_PRECONDITION'));

            const { result } = await renderReady('org-A');

            expect(result.current.vehicles).toEqual(VEHICLES);
            expect(result.current.records).toEqual([]);
        });

        it('차량 조회가 실패해도 주유 기록은 보여 준다', async () => {
            mockGetVehicles.mockRejectedValue(new Error('permission-denied'));

            const { result } = await renderReady('org-A');

            expect(result.current.vehicles).toEqual([]);
            expect(result.current.records).toHaveLength(3);
        });

        it('기관이 바뀌면 새 기관 ID로 다시 불러온다', async () => {
            const { rerender } = renderHook(({ org }) => useBaseFuelLog(org), { initialProps: { org: 'org-A' } });
            await waitFor(() => expect(mockGetFuelLogs).toHaveBeenCalledWith('org-A'));

            rerender({ org: 'org-B' });

            await waitFor(() => expect(mockGetFuelLogs).toHaveBeenCalledWith('org-B'));
            expect(mockGetVehicles).toHaveBeenCalledWith('org-B');
        });
    });

    describe('합계', () => {
        it('전체 금액·주유량을 더하고 비어 있는 값은 0으로 본다', async () => {
            const { result } = await renderReady('org-A');

            expect(result.current.totalCost).toBe(70000);
            expect(result.current.totalAmount).toBeCloseTo(40.5);
        });

        it('calculateStats는 넘겨받은 기록만 더한다', async () => {
            const { result } = await renderReady('org-A');

            expect(result.current.calculateStats([RECORDS[1]])).toEqual({ cost: 20000, amount: 10 });
            expect(result.current.calculateStats([])).toEqual({ cost: 0, amount: 0 });
        });
    });

    describe('삭제', () => {
        it('확인 후 삭제하고 목록에서 빼며 합계도 다시 계산한다', async () => {
            const { result } = await renderReady('org-A');
            const onSuccess = vi.fn();

            let ok: boolean | undefined;
            await act(async () => { ok = await result.current.handleDeleteBase(RECORDS[0], undefined, onSuccess); });

            expect(ok).toBe(true);
            expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ confirmColor: 'danger' }));
            expect(mockDeleteFuelLog).toHaveBeenCalledWith('r1');
            expect(result.current.records.map(r => r.id)).toEqual(['r2', 'r3']);
            expect(result.current.totalCost).toBe(20000);
            expect(mockShowToast).toHaveBeenCalledWith('주유 기록이 삭제되었습니다.', 'success');
            expect(onSuccess).toHaveBeenCalled();
        });

        it('본인 확인 uid가 다르면 확인창도 띄우지 않고 막는다', async () => {
            const { result } = await renderReady('org-A');

            await act(async () => { await result.current.handleDeleteBase(RECORDS[1], 'emp-1'); });

            expect(mockConfirm).not.toHaveBeenCalled();
            expect(mockDeleteFuelLog).not.toHaveBeenCalled();
            expect(mockShowToast).toHaveBeenCalledWith('본인의 주유 기록만 삭제할 수 있습니다.', 'warning');
        });

        it('본인 기록이면 확인 후 삭제한다', async () => {
            const { result } = await renderReady('org-A');

            await act(async () => { await result.current.handleDeleteBase(RECORDS[0], 'emp-1'); });

            expect(mockDeleteFuelLog).toHaveBeenCalledWith('r1');
        });

        it('확인창에서 취소하면 삭제하지 않는다', async () => {
            mockConfirm.mockResolvedValue(false);
            const { result } = await renderReady('org-A');
            const onSuccess = vi.fn();

            await act(async () => { await result.current.handleDeleteBase(RECORDS[0], undefined, onSuccess); });

            expect(mockDeleteFuelLog).not.toHaveBeenCalled();
            expect(result.current.records).toHaveLength(3);
            expect(onSuccess).not.toHaveBeenCalled();
        });

        it('삭제가 실패하면 목록을 그대로 두고 false·오류 토스트를 낸다', async () => {
            mockDeleteFuelLog.mockRejectedValue(new Error('permission-denied'));
            const { result } = await renderReady('org-A');
            const onSuccess = vi.fn();

            let ok: boolean | undefined;
            await act(async () => { ok = await result.current.handleDeleteBase(RECORDS[0], undefined, onSuccess); });

            expect(ok).toBe(false);
            expect(result.current.records).toHaveLength(3);
            expect(mockShowToast).toHaveBeenCalledWith('삭제에 실패했습니다.', 'error');
            expect(onSuccess).not.toHaveBeenCalled();
        });
    });
});
