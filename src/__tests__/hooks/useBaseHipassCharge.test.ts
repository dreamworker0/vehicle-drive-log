import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { HipassCharge } from '../../types/hipassCharge';

/**
 * useBaseHipassCharge — 하이패스 충전 기록의 로드·합계·삭제 기반 훅.
 * 고정하는 계약:
 *  - 관리자는 기관 전체 충전 기록+카드, 직원은 카드·차량만 먼저 읽는다(모두 기관 ID로)
 *  - 잔액 되돌리기는 서버(onHipassChargeDeleted)가 한다 — 훅은 카드 잔액을 **화면에서만** 맞추고
 *    카드 갱신 API를 부르지 않는다(이중 반영 방지)
 *  - 되돌릴 카드가 없으면 성공이라고 말하지 않는다(경고 토스트)
 */
const mockShowToast = vi.fn();
const mockConfirm = vi.fn();
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => ({ confirm: mockConfirm }) }));

const mockGetVehicles = vi.fn();
const mockGetHipassCards = vi.fn();
const mockGetAllHipassCharges = vi.fn();
const mockGetHipassCharges = vi.fn();
const mockDeleteHipassCharge = vi.fn();
const mockUpdateHipassCard = vi.fn();
vi.mock('../../lib/firestore', () => ({
    getVehicles: (...a: unknown[]) => mockGetVehicles(...a),
    getHipassCards: (...a: unknown[]) => mockGetHipassCards(...a),
    getAllHipassCharges: (...a: unknown[]) => mockGetAllHipassCharges(...a),
    getHipassCharges: (...a: unknown[]) => mockGetHipassCharges(...a),
    deleteHipassCharge: (...a: unknown[]) => mockDeleteHipassCharge(...a),
    updateHipassCard: (...a: unknown[]) => mockUpdateHipassCard(...a),
}));

import useBaseHipassCharge from '../../hooks/base/useBaseHipassCharge';

const VEHICLES = [{ id: 'v1', displayName: '쏘나타' }];
const CARDS = [
    { id: 'c1', cardNumber: '1111-2222', balance: 50000, vehicleId: 'v1' },
    { id: 'c2', cardNumber: '3333-4444', balance: 10000, vehicleId: 'v2' },
];
const CHARGES = [
    { id: 'ch1', cardId: 'c1', chargeAmount: 30000, chargerUid: 'emp-1' },
    { id: 'ch2', cardId: 'c2', chargeAmount: 20000, chargerUid: 'emp-2' },
    { id: 'ch3', cardId: 'gone', chargeAmount: 5000, chargerUid: 'emp-1' },
] as unknown as HipassCharge[];

async function renderReady(orgId: string | undefined, isAdmin = false) {
    const hook = renderHook(() => useBaseHipassCharge(orgId, { isAdmin }));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    return hook;
}

describe('useBaseHipassCharge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetVehicles.mockResolvedValue(VEHICLES);
        mockGetHipassCards.mockResolvedValue(CARDS);
        mockGetAllHipassCharges.mockResolvedValue(CHARGES);
        mockGetHipassCharges.mockResolvedValue([CHARGES[0]]);
        mockDeleteHipassCharge.mockResolvedValue(undefined);
        mockConfirm.mockResolvedValue(true);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    describe('초기 로드', () => {
        it('관리자는 기관 전체 충전 기록·카드·차량을 기관 ID로 읽는다', async () => {
            const { result } = await renderReady('org-A', true);

            expect(mockGetAllHipassCharges).toHaveBeenCalledWith('org-A');
            expect(mockGetHipassCards).toHaveBeenCalledWith('org-A');
            expect(mockGetVehicles).toHaveBeenCalledWith('org-A');
            expect(result.current.records).toEqual(CHARGES);
            expect(result.current.cards).toEqual(CARDS);
        });

        it('직원은 카드·차량만 읽고 충전 기록은 카드를 고른 뒤에 읽는다', async () => {
            const { result } = await renderReady('org-A', false);

            expect(mockGetAllHipassCharges).not.toHaveBeenCalled();
            expect(mockGetHipassCards).toHaveBeenCalledWith('org-A');
            expect(result.current.records).toEqual([]);
            expect(result.current.vehicles).toEqual(VEHICLES);
        });

        it('옵션 없이 부르면 직원 모드다', async () => {
            const hook = renderHook(() => useBaseHipassCharge('org-A'));
            await waitFor(() => expect(hook.result.current.loading).toBe(false));

            expect(mockGetAllHipassCharges).not.toHaveBeenCalled();
        });

        it('기관 ID가 없으면 아무것도 읽지 않는다', async () => {
            await renderReady(undefined, true);

            expect(mockGetVehicles).not.toHaveBeenCalled();
            expect(mockGetHipassCards).not.toHaveBeenCalled();
            expect(mockGetAllHipassCharges).not.toHaveBeenCalled();
        });

        it('관리자 로드에서 충전 기록만 실패해도 카드·차량은 보여 준다', async () => {
            mockGetAllHipassCharges.mockRejectedValue(new Error('index building'));

            const { result } = await renderReady('org-A', true);

            expect(result.current.records).toEqual([]);
            expect(result.current.cards).toEqual(CARDS);
            expect(result.current.vehicles).toEqual(VEHICLES);
        });

        it('직원 로드에서 카드만 실패해도 차량은 보여 준다', async () => {
            mockGetHipassCards.mockRejectedValue(new Error('permission-denied'));

            const { result } = await renderReady('org-A', false);

            expect(result.current.cards).toEqual([]);
            expect(result.current.vehicles).toEqual(VEHICLES);
        });
    });

    describe('loadRecordsForCard', () => {
        it('기관 ID와 카드 ID로 그 카드의 충전 기록을 읽는다', async () => {
            const { result } = await renderReady('org-A');

            await act(async () => { await result.current.loadRecordsForCard('c1'); });

            expect(mockGetHipassCharges).toHaveBeenCalledWith('org-A', 'c1');
            expect(result.current.records).toEqual([CHARGES[0]]);
        });

        it('카드 ID가 비면 조회 없이 목록을 비운다', async () => {
            const { result } = await renderReady('org-A', true);
            expect(result.current.records).toHaveLength(3);

            await act(async () => { await result.current.loadRecordsForCard(''); });

            expect(mockGetHipassCharges).not.toHaveBeenCalled();
            expect(result.current.records).toEqual([]);
        });

        it('조회가 실패하면 목록을 비운다', async () => {
            const { result } = await renderReady('org-A', true);
            mockGetHipassCharges.mockRejectedValue(new Error('offline'));

            await act(async () => { await result.current.loadRecordsForCard('c1'); });

            expect(result.current.records).toEqual([]);
        });
    });

    it('calculateTotalCharge는 충전액을 더하고 빈 값은 0으로 본다', async () => {
        const { result } = await renderReady('org-A');

        expect(result.current.calculateTotalCharge(CHARGES)).toBe(55000);
        expect(result.current.calculateTotalCharge([{ id: 'x' } as unknown as HipassCharge])).toBe(0);
    });

    describe('handleDeleteBase', () => {
        it('잔액 되돌리기 삭제는 화면의 카드 잔액만 줄이고 카드 갱신 API는 부르지 않는다 (서버 트리거가 반영)', async () => {
            const { result } = await renderReady('org-A', true);
            const onSuccess = vi.fn();

            let ok: boolean | undefined;
            await act(async () => {
                ok = await result.current.handleDeleteBase(CHARGES[0], { rollbackBalance: true, onSuccess });
            });

            expect(ok).toBe(true);
            expect(mockConfirm.mock.calls[0][0].message).toContain('카드 잔액이 원래대로 되돌아갑니다');
            expect(mockDeleteHipassCharge).toHaveBeenCalledWith('ch1');
            expect(mockUpdateHipassCard).not.toHaveBeenCalled();
            expect(result.current.cards.find(c => c.id === 'c1')!.balance).toBe(20000);
            expect(result.current.cards.find(c => c.id === 'c2')!.balance).toBe(10000);
            expect(result.current.records.map(r => r.id)).toEqual(['ch2', 'ch3']);
            expect(mockShowToast).toHaveBeenCalledWith('충전 기록이 삭제되었습니다.', 'success');
            expect(onSuccess).toHaveBeenCalled();
        });

        it('화면 잔액은 0 아래로 내려가지 않는다', async () => {
            const { result } = await renderReady('org-A', true);

            await act(async () => {
                await result.current.handleDeleteBase(CHARGES[1], { rollbackBalance: true });
            });

            expect(result.current.cards.find(c => c.id === 'c2')!.balance).toBe(0);
        });

        it('되돌릴 카드가 이미 없으면 기록은 지우되 성공이라고 말하지 않는다', async () => {
            const { result } = await renderReady('org-A', true);
            const onSuccess = vi.fn();

            let ok: boolean | undefined;
            await act(async () => {
                ok = await result.current.handleDeleteBase(CHARGES[2], { rollbackBalance: true, onSuccess });
            });

            expect(ok).toBe(true);
            expect(mockDeleteHipassCharge).toHaveBeenCalledWith('ch3');
            expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('카드 잔액을 되돌리지 못했습니다'), 'warning');
            expect(mockShowToast).not.toHaveBeenCalledWith('충전 기록이 삭제되었습니다.', 'success');
            expect(onSuccess).toHaveBeenCalled();
        });

        it('잔액 되돌리기 없이 지우면 카드 잔액은 그대로이고 확인 문구에도 약속하지 않는다', async () => {
            const { result } = await renderReady('org-A', true);

            await act(async () => { await result.current.handleDeleteBase(CHARGES[0]); });

            expect(mockConfirm.mock.calls[0][0].message).toBe('이 충전 기록을 삭제하시겠습니까?');
            expect(result.current.cards.find(c => c.id === 'c1')!.balance).toBe(50000);
            expect(mockShowToast).toHaveBeenCalledWith('충전 기록이 삭제되었습니다.', 'success');
        });

        it('본인 기록이 아니면 확인창 없이 막고 false다', async () => {
            const { result } = await renderReady('org-A', true);

            let ok: boolean | undefined;
            await act(async () => { ok = await result.current.handleDeleteBase(CHARGES[1], { checkingUid: 'emp-1' }); });

            expect(ok).toBe(false);
            expect(mockConfirm).not.toHaveBeenCalled();
            expect(mockDeleteHipassCharge).not.toHaveBeenCalled();
            expect(mockShowToast).toHaveBeenCalledWith('본인의 충전 기록만 삭제할 수 있습니다.', 'warning');
        });

        it('확인창에서 취소하면 false이고 아무것도 바꾸지 않는다', async () => {
            mockConfirm.mockResolvedValue(false);
            const { result } = await renderReady('org-A', true);

            let ok: boolean | undefined;
            await act(async () => { ok = await result.current.handleDeleteBase(CHARGES[0], { rollbackBalance: true }); });

            expect(ok).toBe(false);
            expect(mockDeleteHipassCharge).not.toHaveBeenCalled();
            expect(result.current.cards.find(c => c.id === 'c1')!.balance).toBe(50000);
        });

        it('삭제가 실패하면 잔액·목록을 그대로 두고 오류 토스트와 false', async () => {
            mockDeleteHipassCharge.mockRejectedValue(new Error('permission-denied'));
            const { result } = await renderReady('org-A', true);
            const onSuccess = vi.fn();

            let ok: boolean | undefined;
            await act(async () => {
                ok = await result.current.handleDeleteBase(CHARGES[0], { rollbackBalance: true, onSuccess });
            });

            expect(ok).toBe(false);
            expect(result.current.cards.find(c => c.id === 'c1')!.balance).toBe(50000);
            expect(result.current.records).toHaveLength(3);
            expect(mockShowToast).toHaveBeenCalledWith('삭제에 실패했습니다.', 'error');
            expect(onSuccess).not.toHaveBeenCalled();
        });
    });
});
