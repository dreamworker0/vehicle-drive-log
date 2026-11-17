/**
 * PurposeChips — 운행 목적 칸 아래 '자주 쓰는 목적' 단추 줄
 *
 * 운행일지·바로 운행·예약 세 화면이 같이 쓴다. 등록한 것이 없으면 아무것도 그리지 않아
 * 기존 입력 흐름을 방해하지 않아야 한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const showToast = vi.fn();
const add = vi.fn();
let hookState: { purposes: Array<{ id: string; userId: string; text: string }>; isFull: boolean };

vi.mock('../../hooks/useFavoritePurposes', () => ({
    useFavoritePurposes: () => ({
        ...hookState,
        loading: false,
        has: (text: string) => hookState.purposes.some(p => p.text === text.trim()),
        add,
        remove: vi.fn(),
    }),
}));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../../lib/sentry', () => ({ captureError: vi.fn() }));
vi.mock('../../lib/firestore', () => ({ MAX_FAVORITE_PURPOSES: 20 }));

import PurposeChips from '../../components/common/PurposeChips';

const registered = [
    { id: 'p1', userId: 'u1', text: '가정방문' },
    { id: 'p2', userId: 'u1', text: '병원 동행' },
];
const SAVE_LABEL = '+ 자주 쓰는 목적에 저장';

describe('PurposeChips', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hookState = { purposes: [], isFull: false };
    });

    it('등록한 목적도 없고 칸도 비어 있으면 아무것도 그리지 않는다', () => {
        const { container } = render(<PurposeChips value="" onSelect={vi.fn()} />);
        expect(container.firstChild).toBeNull();
    });

    it('단추를 누르면 그 문구로 목적 칸을 채운다', () => {
        hookState.purposes = registered;
        const onSelect = vi.fn();
        render(<PurposeChips value="" onSelect={onSelect} />);

        fireEvent.click(screen.getByRole('button', { name: '병원 동행' }));
        expect(onSelect).toHaveBeenCalledWith('병원 동행');
    });

    it('지금 칸의 값과 같은 단추는 눌린 상태로 보인다', () => {
        hookState.purposes = registered;
        render(<PurposeChips value="가정방문" onSelect={vi.fn()} />);
        expect(screen.getByRole('button', { name: '가정방문' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: '병원 동행' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('목록에 없는 문구를 적으면 바로 저장하는 버튼이 뜨고, 누르면 저장 후 알린다', async () => {
        add.mockResolvedValue('added');
        render(<PurposeChips value=" 물품 구매 " onSelect={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: SAVE_LABEL }));

        await waitFor(() => expect(showToast).toHaveBeenCalledWith('자주 쓰는 목적에 저장했어요', 'success'));
        expect(add).toHaveBeenCalledWith('물품 구매');
    });

    it('이미 등록된 문구이거나 목록이 꽉 찼으면 저장 버튼을 숨긴다', () => {
        hookState.purposes = registered;
        const { rerender } = render(<PurposeChips value="가정방문" onSelect={vi.fn()} />);
        expect(screen.queryByRole('button', { name: SAVE_LABEL })).toBeNull();

        hookState.isFull = true;
        rerender(<PurposeChips value="새 목적" onSelect={vi.fn()} />);
        expect(screen.queryByRole('button', { name: SAVE_LABEL })).toBeNull();
    });

    it('저장이 실패하면 오류를 알린다', async () => {
        add.mockRejectedValue(new Error('offline'));
        render(<PurposeChips value="새 목적" onSelect={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: SAVE_LABEL }));
        await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringContaining('저장하지 못했어요'), 'error'));
    });
});
