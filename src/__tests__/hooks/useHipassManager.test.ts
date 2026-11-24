import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { HipassCard } from '../../types/hipass';

/**
 * useHipassManager — 관리자 하이패스 카드 관리.
 * 고정하는 계약:
 *  - 기관 ID로 카드·차량을 읽고, 퇴역 차량은 고를 수 없다
 *  - 한 차량에는 카드 하나만(수정 중인 자기 카드는 예외)
 *  - **수정 시 잔액은 폼에서 실제로 바꿨을 때만 보낸다** — 폼을 열어 둔 사이 트리거가 내린
 *    잔액을 옛 값으로 되돌리지 않게(Phase 227)
 *  - 카드번호는 숫자만 16자리, 4자리마다 하이픈
 */
const mockShowToast = vi.fn();
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ showToast: mockShowToast }) }));

const authState: { userData: { organizationId?: string } | null } = { userData: { organizationId: 'org-A' } };
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => authState }));

const mockGetCards = vi.fn();
const mockGetVehicles = vi.fn();
const mockCreateCard = vi.fn();
const mockUpdateCard = vi.fn();
const mockDeleteCard = vi.fn();
vi.mock('../../lib/firestore', () => ({
    getHipassCards: (...a: unknown[]) => mockGetCards(...a),
    getVehicles: (...a: unknown[]) => mockGetVehicles(...a),
    createHipassCard: (...a: unknown[]) => mockCreateCard(...a),
    updateHipassCard: (...a: unknown[]) => mockUpdateCard(...a),
    deleteHipassCard: (...a: unknown[]) => mockDeleteCard(...a),
}));

import useHipassManager from '../../hooks/useHipassManager';

const VEHICLES = [
    { id: 'v1', displayName: '쏘나타' },
    { id: 'v2', displayName: '스타리아' },
    { id: 'v3', displayName: '포터' },
    { id: 'v-old', displayName: '퇴역차', retired: { isRetired: true } },
];
const CARD1 = { id: 'c1', cardNumber: '1111-2222-3333-4444', vehicleId: 'v1', balance: 50000, memo: '메모' } as unknown as HipassCard;
const CARD2 = { id: 'c2', cardNumber: '5555-6666', vehicleId: 'v2', balance: 0 } as unknown as HipassCard;

const submitEvent = () => ({ preventDefault: vi.fn() }) as unknown as React.FormEvent;

async function renderReady() {
    const hook = renderHook(() => useHipassManager());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    return hook;
}

describe('useHipassManager', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        authState.userData = { organizationId: 'org-A' };
        mockGetCards.mockResolvedValue([CARD1, CARD2]);
        mockGetVehicles.mockResolvedValue(VEHICLES);
        mockCreateCard.mockResolvedValue('c-new');
        mockUpdateCard.mockResolvedValue(undefined);
        mockDeleteCard.mockResolvedValue(undefined);
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    describe('로드', () => {
        it('기관 ID로 카드·차량을 읽고 퇴역 차량은 뺀다', async () => {
            const { result } = await renderReady();

            expect(mockGetCards).toHaveBeenCalledWith('org-A');
            expect(mockGetVehicles).toHaveBeenCalledWith('org-A');
            expect(result.current.cards).toEqual([CARD1, CARD2]);
            expect(result.current.vehicles.map(v => v.id)).toEqual(['v1', 'v2', 'v3']);
        });

        it('기관 ID가 없으면 읽지 않는다', async () => {
            authState.userData = null;

            const { result } = await renderReady();

            expect(mockGetCards).not.toHaveBeenCalled();
            expect(result.current.cards).toEqual([]);
        });

        it('한쪽 조회가 실패해도 다른 쪽은 보여 준다', async () => {
            mockGetCards.mockRejectedValue(new Error('index'));

            const { result } = await renderReady();

            expect(result.current.cards).toEqual([]);
            expect(result.current.vehicles).toHaveLength(3);
        });

        it('카드가 없는 차량만 고를 수 있고, 수정 중이면 자기 카드의 차량도 고를 수 있다', async () => {
            const { result } = await renderReady();
            expect(result.current.availableVehicles.map(v => v.id)).toEqual(['v3']);

            act(() => { result.current.handleEdit(CARD1); });

            expect(result.current.availableVehicles.map(v => v.id)).toEqual(['v1', 'v3']);
        });

        it('getVehicleById는 퇴역하지 않은 차량만 찾는다', async () => {
            const { result } = await renderReady();

            expect(result.current.getVehicleById('v2')?.displayName).toBe('스타리아');
            expect(result.current.getVehicleById('v-old')).toBeUndefined();
        });
    });

    describe('카드번호 입력', () => {
        it.each([
            ['1234567812345678', '1234-5678-1234-5678'],
            ['1234-56ab78', '1234-5678'],
            ['12345678123456789999', '1234-5678-1234-5678'], // 16자리에서 자른다
            ['123', '123'],
            ['', ''],
        ])('%s → %s', async (raw, expected) => {
            const { result } = await renderReady();

            act(() => { result.current.handleCardNumberChange(raw); });

            expect(result.current.form.cardNumber).toBe(expected);
        });
    });

    describe('등록', () => {
        it('기관 ID·차량명·정수 잔액으로 등록하고 폼을 닫은 뒤 다시 읽는다', async () => {
            const { result } = await renderReady();
            act(() => {
                result.current.setShowForm(true);
                result.current.setForm({ cardNumber: ' 9999-0000 ', vehicleId: 'v3', balance: '30000.9', memo: '  새 카드 ' });
            });

            await act(async () => { await result.current.handleSubmit(submitEvent()); });

            expect(mockCreateCard).toHaveBeenCalledWith({
                cardNumber: '9999-0000',
                vehicleId: 'v3',
                vehicleName: '포터',
                balance: 30000,
                memo: '새 카드',
                organizationId: 'org-A',
            });
            expect(mockShowToast).toHaveBeenCalledWith('하이패스가 등록되었습니다.', 'success');
            expect(result.current.showForm).toBe(false);
            expect(result.current.form).toEqual({ cardNumber: '', vehicleId: '', balance: '', memo: '' });
            expect(mockGetCards).toHaveBeenCalledTimes(2);
            expect(result.current.formLoading).toBe(false);
        });

        it('잔액을 비우면 0으로 등록한다', async () => {
            const { result } = await renderReady();
            act(() => { result.current.setForm({ cardNumber: '1234', vehicleId: 'v3', balance: '', memo: '' }); });

            await act(async () => { await result.current.handleSubmit(submitEvent()); });

            expect(mockCreateCard.mock.calls[0][0].balance).toBe(0);
        });

        it.each([
            ['카드번호에 숫자가 없을 때', { cardNumber: '----', vehicleId: 'v3' }],
            ['차량을 고르지 않았을 때', { cardNumber: '1234', vehicleId: '' }],
        ])('%s 저장하지 않는다', async (_label, fields) => {
            const { result } = await renderReady();
            act(() => { result.current.setForm({ balance: '', memo: '', ...fields }); });

            await act(async () => { await result.current.handleSubmit(submitEvent()); });

            expect(mockCreateCard).not.toHaveBeenCalled();
            expect(mockShowToast).toHaveBeenCalledWith('카드번호와 차량을 입력해주세요.', 'error');
        });

        it('잔액이 음수면 저장하지 않는다', async () => {
            const { result } = await renderReady();
            act(() => { result.current.setForm({ cardNumber: '1234', vehicleId: 'v3', balance: '-100', memo: '' }); });

            await act(async () => { await result.current.handleSubmit(submitEvent()); });

            expect(mockCreateCard).not.toHaveBeenCalled();
            expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('현재 잔액'), 'error');
        });

        it('이미 다른 카드가 연결된 차량이면 저장하지 않는다', async () => {
            const { result } = await renderReady();
            act(() => { result.current.setForm({ cardNumber: '1234', vehicleId: 'v1', balance: '', memo: '' }); });

            await act(async () => { await result.current.handleSubmit(submitEvent()); });

            expect(mockCreateCard).not.toHaveBeenCalled();
            expect(mockShowToast).toHaveBeenCalledWith('이 차량에는 이미 하이패스가 연결되어 있습니다.', 'error');
            expect(result.current.formLoading).toBe(false);
        });

        it('저장이 실패하면 폼을 유지하고 오류 토스트를 낸다', async () => {
            mockCreateCard.mockRejectedValue(new Error('permission-denied'));
            const { result } = await renderReady();
            act(() => {
                result.current.setShowForm(true);
                result.current.setForm({ cardNumber: '1234', vehicleId: 'v3', balance: '', memo: '' });
            });

            await act(async () => { await result.current.handleSubmit(submitEvent()); });

            expect(result.current.showForm).toBe(true);
            expect(result.current.form.vehicleId).toBe('v3');
            expect(result.current.formLoading).toBe(false);
            expect(mockShowToast).toHaveBeenCalledWith('저장에 실패했습니다.', 'error');
        });
    });

    describe('수정', () => {
        it('폼을 카드 값으로 연다 (잔액이 없으면 0)', async () => {
            const { result } = await renderReady();

            act(() => { result.current.handleEdit({ ...CARD2, balance: undefined, memo: undefined } as unknown as HipassCard); });

            expect(result.current.editingCard?.id).toBe('c2');
            expect(result.current.showForm).toBe(true);
            expect(result.current.form).toEqual({ cardNumber: '5555-6666', vehicleId: 'v2', balance: '0', memo: '' });
        });

        it('잔액을 건드리지 않았으면 잔액 필드를 보내지 않는다 — 트리거가 내린 잔액을 덮지 않게', async () => {
            const { result } = await renderReady();
            act(() => { result.current.handleEdit(CARD1); });
            act(() => { result.current.setForm(prev => ({ ...prev, memo: '메모만 수정' })); });

            await act(async () => { await result.current.handleSubmit(submitEvent()); });

            expect(mockUpdateCard).toHaveBeenCalledTimes(1);
            const [id, data] = mockUpdateCard.mock.calls[0];
            expect(id).toBe('c1');
            expect(data).not.toHaveProperty('balance');
            expect(data).toMatchObject({ memo: '메모만 수정', vehicleId: 'v1', organizationId: 'org-A' });
            expect(mockShowToast).toHaveBeenCalledWith('하이패스 정보가 수정되었습니다.', 'success');
        });

        it('잔액을 실제로 바꿨으면 새 잔액을 보낸다 (실물 카드와 맞추는 수동 정정)', async () => {
            const { result } = await renderReady();
            act(() => { result.current.handleEdit(CARD1); });
            act(() => { result.current.setForm(prev => ({ ...prev, balance: '42000' })); });

            await act(async () => { await result.current.handleSubmit(submitEvent()); });

            expect(mockUpdateCard.mock.calls[0][1]).toMatchObject({ balance: 42000 });
        });

        it('잔액이 없던 카드를 0 그대로 저장하면 잔액을 보내지 않는다', async () => {
            const { result } = await renderReady();
            act(() => { result.current.handleEdit({ ...CARD2, balance: undefined } as unknown as HipassCard); });

            await act(async () => { await result.current.handleSubmit(submitEvent()); });

            expect(mockUpdateCard.mock.calls[0][1]).not.toHaveProperty('balance');
        });

        it('자기 카드의 차량은 "이미 연결됨"으로 막지 않는다', async () => {
            const { result } = await renderReady();
            act(() => { result.current.handleEdit(CARD1); });

            await act(async () => { await result.current.handleSubmit(submitEvent()); });

            expect(mockUpdateCard).toHaveBeenCalled();
        });

        it('수정 중에 다른 카드의 차량으로 옮기면 막는다', async () => {
            const { result } = await renderReady();
            act(() => { result.current.handleEdit(CARD1); });
            act(() => { result.current.setForm(prev => ({ ...prev, vehicleId: 'v2' })); });

            await act(async () => { await result.current.handleSubmit(submitEvent()); });

            expect(mockUpdateCard).not.toHaveBeenCalled();
        });

        it('resetForm은 수정 상태를 지우고 폼을 닫는다', async () => {
            const { result } = await renderReady();
            act(() => { result.current.handleEdit(CARD1); });

            act(() => { result.current.resetForm(); });

            expect(result.current.editingCard).toBeNull();
            expect(result.current.showForm).toBe(false);
            expect(result.current.form.cardNumber).toBe('');
        });
    });

    describe('삭제', () => {
        it('모달에서 확인하면 그 카드를 지우고 다시 읽은 뒤 모달을 닫는다', async () => {
            const { result } = await renderReady();
            act(() => { result.current.openDeleteModal(CARD2); });
            expect(result.current.modal).toEqual({ type: 'delete', card: CARD2 });

            await act(async () => { await result.current.confirmDelete(); });

            expect(mockDeleteCard).toHaveBeenCalledWith('c2');
            expect(mockShowToast).toHaveBeenCalledWith('하이패스가 삭제되었습니다.', 'success');
            expect(mockGetCards).toHaveBeenCalledTimes(2);
            expect(result.current.modal).toBeNull();
        });

        it('모달이 없으면 아무것도 지우지 않는다', async () => {
            const { result } = await renderReady();

            await act(async () => { await result.current.confirmDelete(); });

            expect(mockDeleteCard).not.toHaveBeenCalled();
        });

        it('삭제가 실패해도 모달은 닫고 오류 토스트를 낸다', async () => {
            mockDeleteCard.mockRejectedValue(new Error('permission-denied'));
            const { result } = await renderReady();
            act(() => { result.current.openDeleteModal(CARD1); });

            await act(async () => { await result.current.confirmDelete(); });

            expect(mockShowToast).toHaveBeenCalledWith('삭제에 실패했습니다.', 'error');
            expect(result.current.modal).toBeNull();
        });

        it('closeModal은 모달을 닫는다', async () => {
            const { result } = await renderReady();
            act(() => { result.current.openDeleteModal(CARD1); });

            act(() => { result.current.closeModal(); });

            expect(result.current.modal).toBeNull();
        });
    });
});
