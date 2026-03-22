import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// ── Mocks ──
vi.mock('../../hooks/useAuth', () => ({
    useAuth: () => ({
        user: { uid: 'emp1', displayName: '김직원' },
        userData: { organizationId: 'org1', name: '김직원' },
    }),
}));

const mockShowToast = vi.fn();
vi.mock('../../hooks/useToast', () => ({
    useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock('../../hooks/useConfirm', () => ({
    useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true) }),
}));

vi.mock('../../lib/dateUtils', () => ({
    toLocalDateStr: () => '2026-03-15',
}));

const mockCards = [
    { id: 'c1', cardNumber: '1234-5678', balance: 50000, vehicleId: 'v1', vehicleName: '소나타', organizationId: 'org1' },
];

const mockVehicles = [
    { id: 'v1', displayName: '소나타', vehicleType: 'sedan' },
];

const mockCharges = [
    { id: 'ch1', cardId: 'c1', chargeAmount: 30000, chargerUid: 'emp1', date: '2026-03-10', balanceBefore: 20000, balanceAfter: 50000 },
];

const mockGetHipassCards = vi.fn().mockResolvedValue(mockCards);
const mockGetVehicles = vi.fn().mockResolvedValue(mockVehicles);
const mockGetHipassCharges = vi.fn().mockResolvedValue(mockCharges);
const mockCreateHipassCharge = vi.fn().mockResolvedValue('ch2');
const mockDeleteHipassCharge = vi.fn().mockResolvedValue({});
const mockUpdateHipassCard = vi.fn().mockResolvedValue({});

vi.mock('../../lib/firestore', () => ({
    getHipassCards: (...args: unknown[]) => mockGetHipassCards(...args),
    getVehicles: (...args: unknown[]) => mockGetVehicles(...args),
    getHipassCharges: (...args: unknown[]) => mockGetHipassCharges(...args),
    createHipassCharge: (...args: unknown[]) => mockCreateHipassCharge(...args),
    deleteHipassCharge: (...args: unknown[]) => mockDeleteHipassCharge(...args),
    updateHipassCard: (...args: unknown[]) => mockUpdateHipassCard(...args),
}));

import useHipassCharge from '../../hooks/useHipassCharge';

describe('useHipassCharge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetHipassCards.mockResolvedValue(mockCards);
        mockGetVehicles.mockResolvedValue(mockVehicles);
        mockGetHipassCharges.mockResolvedValue(mockCharges);
    });

    it('초기 로딩 후 카드 목록이 로드된다', async () => {
        const { result } = renderHook(() => useHipassCharge());

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.cards).toHaveLength(1);
        expect(result.current.vehicles).toHaveLength(1);
    });

    it('카드가 1개면 자동 선택된다', async () => {
        const { result } = renderHook(() => useHipassCharge());

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.selectedCardId).toBe('c1');
    });

    it('충전 기록이 로드되고 합계가 계산된다', async () => {
        const { result } = renderHook(() => useHipassCharge());

        await waitFor(() => expect(result.current.loading).toBe(false));
        await waitFor(() => expect(result.current.records).toHaveLength(1));

        expect(result.current.totalChargeAmount).toBe(30000);
    });

    it('handleCardSelect가 카드를 선택하고 폼을 초기화한다', async () => {
        const { result } = renderHook(() => useHipassCharge());

        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.handleCardSelect('c1');
        });

        expect(result.current.selectedCardId).toBe('c1');
        expect(result.current.showForm).toBe(false);
    });

    it('selectedCard가 선택된 카드 객체를 반환한다', async () => {
        const { result } = renderHook(() => useHipassCharge());

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.selectedCard?.cardNumber).toBe('1234-5678');
    });

    it('balanceAfter가 충전금액 입력 시 계산된다', async () => {
        const { result } = renderHook(() => useHipassCharge());

        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.setForm({ date: '2026-03-15', chargeAmount: '10000' });
        });

        expect(result.current.balanceAfter).toBe(60000); // 50000 + 10000
    });

    it('getVehicleById가 차량을 찾는다', async () => {
        const { result } = renderHook(() => useHipassCharge());

        await waitFor(() => expect(result.current.loading).toBe(false));

        const vehicle = result.current.getVehicleById('v1');
        expect(vehicle?.displayName).toBe('소나타');

        const notFound = result.current.getVehicleById('v999');
        expect(notFound).toBeNull();
    });

    it('showForm 토글이 동작한다', async () => {
        const { result } = renderHook(() => useHipassCharge());

        expect(result.current.showForm).toBe(false);

        act(() => {
            result.current.setShowForm(true);
        });

        expect(result.current.showForm).toBe(true);
    });
});
