/**
 * useHipassChargeAdmin — 관리자용 하이패스 충전 기록 관리 훅
 *
 * 여기서 지켜야 할 것은 '금액을 고치면 카드 잔액도 같이 맞는가'다. 충전 기록은 생성 시
 * 카드 잔액을 올리므로(useHipassCharge), 정정이 기록만 바꾸면 앱이 들고 있는 잔액이
 * 조용히 거짓이 된다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const mockShowToast = vi.fn();
const mockConfirm = vi.fn().mockResolvedValue(true);

vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => ({ confirm: mockConfirm }) }));
vi.mock('../../hooks/useAuth', () => ({
    useAuth: () => ({ user: { uid: 'admin-1' }, userData: { organizationId: 'org-A' } }),
}));

const mockGetVehicles = vi.fn();
const mockGetAllHipassCharges = vi.fn();
const mockGetHipassCards = vi.fn();
const mockUpdateHipassCharge = vi.fn().mockResolvedValue(undefined);
const mockUpdateHipassCard = vi.fn().mockResolvedValue(undefined);
const mockDeleteHipassCharge = vi.fn().mockResolvedValue(undefined);
vi.mock('../../lib/firestore', () => ({
    getVehicles: (...a: unknown[]) => mockGetVehicles(...a),
    getAllHipassCharges: (...a: unknown[]) => mockGetAllHipassCharges(...a),
    getHipassCards: (...a: unknown[]) => mockGetHipassCards(...a),
    getHipassCharges: vi.fn(),
    updateHipassCharge: (...a: unknown[]) => mockUpdateHipassCharge(...a),
    updateHipassCard: (...a: unknown[]) => mockUpdateHipassCard(...a),
    deleteHipassCharge: (...a: unknown[]) => mockDeleteHipassCharge(...a),
}));

import useHipassChargeAdmin from '../../hooks/useHipassChargeAdmin';

const VEHICLES = [{ id: 'v1', displayName: '쏘나타' }];
const CARDS = [{ id: 'c1', cardNumber: '1234-5678', vehicleId: 'v1', balance: 80000 }];
const RECORDS = [
    {
        id: 'h1', organizationId: 'org-A', cardId: 'c1', cardNumber: '1234-5678',
        vehicleId: 'v1', vehicleName: '쏘나타', chargerUid: 'emp-1', chargerName: '김직원',
        date: '2026-09-01', chargeAmount: 50000, balanceBefore: 30000, balanceAfter: 80000,
    },
];

/** 폼 제출 이벤트 대역 — 훅은 preventDefault만 쓴다 */
const submitEvent = () => ({ preventDefault: () => {} }) as React.FormEvent;

/** 로드가 끝난 훅을 돌려준다 */
const renderLoaded = async () => {
    const view = renderHook(() => useHipassChargeAdmin());
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    return view;
};

describe('useHipassChargeAdmin — 관리자 정정', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetVehicles.mockResolvedValue(VEHICLES);
        mockGetAllHipassCharges.mockResolvedValue(RECORDS);
        mockGetHipassCards.mockResolvedValue(CARDS);
        mockConfirm.mockResolvedValue(true);
    });

    it('관리자 화면은 차량·전체 충전 기록과 함께 카드도 읽는다 (잔액 조정에 필요)', async () => {
        const { result } = await renderLoaded();

        expect(mockGetAllHipassCharges).toHaveBeenCalledWith('org-A');
        expect(mockGetHipassCards).toHaveBeenCalledWith('org-A');
        expect(result.current.filteredRecords).toHaveLength(1);
    });

    it('금액을 줄이면 기록과 카드 잔액이 같은 차액만큼 함께 줄어든다', async () => {
        const { result } = await renderLoaded();

        act(() => { result.current.handleEdit(RECORDS[0] as never); });
        expect(result.current.form.chargeAmount).toBe('50000');

        act(() => { result.current.setForm(f => ({ ...f, chargeAmount: '30000' })); });
        await act(async () => { await result.current.handleSubmit(submitEvent()); });

        // 차액이 얼마인지 확인창에 숫자로 보여야 한다 — 잔액이 조용히 바뀌면 안 된다.
        expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining('80,000원 → 60,000원'),
        }));
        expect(mockUpdateHipassCharge).toHaveBeenCalledWith('h1', {
            date: '2026-09-01',
            chargeAmount: 30000,
            // 충전 후 잔액은 '충전 전 잔액 + 새 금액'으로 다시 계산된다
            balanceAfter: 60000,
        });
        expect(mockUpdateHipassCard).toHaveBeenCalledWith('c1', { balance: 60000 });

        const updated = result.current.filteredRecords[0];
        expect(updated.chargeAmount).toBe(30000);
        expect(updated.lastEditedByUid).toBe('admin-1');
        expect(result.current.editingRecord).toBeNull();
    });

    it('확인창에서 취소하면 기록도 카드도 건드리지 않는다', async () => {
        mockConfirm.mockResolvedValue(false);
        const { result } = await renderLoaded();

        act(() => { result.current.handleEdit(RECORDS[0] as never); });
        act(() => { result.current.setForm(f => ({ ...f, chargeAmount: '30000' })); });
        await act(async () => { await result.current.handleSubmit(submitEvent()); });

        expect(mockUpdateHipassCharge).not.toHaveBeenCalled();
        expect(mockUpdateHipassCard).not.toHaveBeenCalled();
        expect(result.current.filteredRecords[0].chargeAmount).toBe(50000);
    });

    it('금액이 그대로면 확인창 없이 날짜만 고치고 카드 잔액은 손대지 않는다', async () => {
        const { result } = await renderLoaded();

        act(() => { result.current.handleEdit(RECORDS[0] as never); });
        act(() => { result.current.setForm(f => ({ ...f, date: '2026-09-02' })); });
        await act(async () => { await result.current.handleSubmit(submitEvent()); });

        expect(mockConfirm).not.toHaveBeenCalled();
        expect(mockUpdateHipassCharge).toHaveBeenCalledWith('h1', { date: '2026-09-02', chargeAmount: 50000 });
        // 충전 후 잔액은 손대지 않는다 — 금액이 그대로인데 다시 계산하면,
        // balanceBefore가 비어 있는 옛 기록에서 멀쩡하던 값이 지워진다.
        expect(mockUpdateHipassCharge.mock.calls[0][1]).not.toHaveProperty('balanceAfter');
        expect(mockUpdateHipassCard).not.toHaveBeenCalled();
    });

    it('충전 전 잔액이 없는 옛 기록도 차액만큼만 움직인다', async () => {
        // balanceBefore가 0(필드 누락 시 스키마 기본값)인 기록에서 'before + 새 금액'으로
        // 다시 계산하면 충전 후 잔액이 통째로 틀어진다. 기준은 balanceAfter여야 한다.
        mockGetAllHipassCharges.mockResolvedValue([{ ...RECORDS[0], balanceBefore: 0, balanceAfter: 80000 }]);
        const { result } = await renderLoaded();

        act(() => { result.current.handleEdit(result.current.filteredRecords[0] as never); });
        act(() => { result.current.setForm(f => ({ ...f, chargeAmount: '40000' })); });
        await act(async () => { await result.current.handleSubmit(submitEvent()); });

        // 50,000 → 40,000이므로 차액 -10,000 → 80,000 - 10,000
        expect(mockUpdateHipassCharge).toHaveBeenCalledWith('h1', expect.objectContaining({ balanceAfter: 70000 }));
    });

    it('지수 표기를 1원으로 읽지 않는다', async () => {
        // `<input type="number">`는 '1e5'를 유효한 값으로 넘긴다. parseInt는 이것을 1로 읽어
        // 100,000원이 1원으로 저장됐다.
        const { result } = await renderLoaded();

        act(() => { result.current.handleEdit(RECORDS[0] as never); });
        act(() => { result.current.setForm(f => ({ ...f, chargeAmount: '1e5' })); });
        await act(async () => { await result.current.handleSubmit(submitEvent()); });

        expect(mockUpdateHipassCharge).toHaveBeenCalledWith('h1', expect.objectContaining({ chargeAmount: 100000 }));
    });

    it('카드가 이미 삭제됐으면 그 사실을 알리고 기록만 고친다', async () => {
        mockGetHipassCards.mockResolvedValue([]);
        const { result } = await renderLoaded();

        act(() => { result.current.handleEdit(RECORDS[0] as never); });
        act(() => { result.current.setForm(f => ({ ...f, chargeAmount: '30000' })); });
        await act(async () => { await result.current.handleSubmit(submitEvent()); });

        expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining('카드 잔액은 조정되지 않습니다'),
        }));
        expect(mockUpdateHipassCharge).toHaveBeenCalledWith('h1', expect.objectContaining({ chargeAmount: 30000 }));
        expect(mockUpdateHipassCard).not.toHaveBeenCalled();
    });

    it('0원 이하·음수 금액은 저장하지 않는다', async () => {
        const { result } = await renderLoaded();

        act(() => { result.current.handleEdit(RECORDS[0] as never); });

        act(() => { result.current.setForm(f => ({ ...f, chargeAmount: '-5000' })); });
        await act(async () => { await result.current.handleSubmit(submitEvent()); });
        expect(mockShowToast).toHaveBeenCalledWith('충전금액에 음수를 입력할 수 없습니다.', 'warning');

        act(() => { result.current.setForm(f => ({ ...f, chargeAmount: '0' })); });
        await act(async () => { await result.current.handleSubmit(submitEvent()); });
        expect(mockShowToast).toHaveBeenCalledWith('올바른 충전금액을 입력해주세요.', 'warning');

        expect(mockUpdateHipassCharge).not.toHaveBeenCalled();
    });

    it('저장에 실패하면 목록을 바꾸지 않고 수정 상태를 유지한다', async () => {
        mockUpdateHipassCharge.mockRejectedValueOnce(new Error('permission-denied'));
        const { result } = await renderLoaded();

        act(() => { result.current.handleEdit(RECORDS[0] as never); });
        act(() => { result.current.setForm(f => ({ ...f, chargeAmount: '30000' })); });
        await act(async () => { await result.current.handleSubmit(submitEvent()); });

        expect(mockShowToast).toHaveBeenCalledWith('수정에 실패했습니다.', 'error');
        expect(mockUpdateHipassCard).not.toHaveBeenCalled();
        expect(result.current.filteredRecords[0].chargeAmount).toBe(50000);
        expect(result.current.editingRecord?.id).toBe('h1');
    });
    it('기록은 저장됐는데 카드 잔액 조정만 실패하면 그 사실 그대로 알린다', async () => {
        // 여기서 통째로 "수정 실패"라고 하면 거짓말이 된다 — 기록은 이미 바뀌었다.
        mockUpdateHipassCard.mockRejectedValueOnce(new Error('permission-denied'));
        const { result } = await renderLoaded();

        act(() => { result.current.handleEdit(RECORDS[0] as never); });
        act(() => { result.current.setForm(f => ({ ...f, chargeAmount: '30000' })); });
        await act(async () => { await result.current.handleSubmit(submitEvent()); });

        expect(mockUpdateHipassCharge).toHaveBeenCalled();
        expect(mockShowToast).toHaveBeenCalledWith(
            '기록은 수정됐지만 카드 잔액 조정에 실패했습니다. [하이패스 관리]에서 잔액을 확인해주세요.',
            'warning',
        );
        // 기록 쪽 변경은 화면에도 반영돼야 한다(실제로 저장됐으므로)
        expect(result.current.filteredRecords[0].chargeAmount).toBe(30000);
    });
    it('관리자 삭제도 카드 잔액을 되돌린다 (정정과 어긋나지 않게)', async () => {
        // 수정은 차액만큼 잔액을 맞추면서 삭제는 두면, 같은 화면에서 어느 버튼을
        // 누르느냐에 따라 잔액이 맞기도 하고 틀리기도 한다.
        const { result } = await renderLoaded();

        await act(async () => { await result.current.handleDelete(RECORDS[0] as never); });

        expect(mockDeleteHipassCharge).toHaveBeenCalledWith('h1');
        // 80,000원 - 50,000원(삭제된 충전금액)
        expect(mockUpdateHipassCard).toHaveBeenCalledWith('c1', { balance: 30000 });
        expect(mockShowToast).toHaveBeenCalledWith('충전 기록이 삭제되었습니다.', 'success');
        await waitFor(() => expect(result.current.filteredRecords).toHaveLength(0));
    });

    it('삭제 확인창에는 잔액이 되돌아간다는 사실이 적힌다', async () => {
        mockConfirm.mockResolvedValue(false);
        const { result } = await renderLoaded();

        await act(async () => { await result.current.handleDelete(RECORDS[0] as never); });

        expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining('카드 잔액이 원래대로 되돌아갑니다'),
        }));
        expect(mockDeleteHipassCharge).not.toHaveBeenCalled();
    });

    it('기록은 지워졌는데 잔액 되돌리기만 실패하면 그 사실 그대로 알린다', async () => {
        mockUpdateHipassCard.mockRejectedValueOnce(new Error('permission-denied'));
        const { result } = await renderLoaded();

        await act(async () => { await result.current.handleDelete(RECORDS[0] as never); });

        expect(mockShowToast).toHaveBeenCalledWith(
            '기록은 삭제됐지만 카드 잔액을 되돌리지 못했습니다. [하이패스 관리]에서 잔액을 확인해주세요.',
            'warning',
        );
        // 삭제 자체는 성공했으므로 목록에서도 빠진다
        await waitFor(() => expect(result.current.filteredRecords).toHaveLength(0));
    });
});
