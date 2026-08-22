/**
 * FeedbackForm — 모달 접근성 역할
 *
 * 이 모달만 다른 모달과 패턴이 반대였다: 화면 전체를 덮는 백드롭이
 * `role="button" tabIndex={0}`이라 탭 순서에 끼고 스크린리더에 버튼으로 읽혔고,
 * 정작 내용 패널이 `role="presentation"`이라 대화상자로 인식되지 않았다.
 *
 * 여기서 고정하는 것은 ConfirmModal과 같은 표준 패턴이다 —
 * 백드롭은 presentation(클릭으로 닫히기만 함), 패널은 aria-modal 대화상자.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase/storage', () => ({
    ref: vi.fn(),
    uploadBytes: vi.fn(),
    getDownloadURL: vi.fn(),
}));
vi.mock('@/lib/firebase', () => ({ storage: {} }));
vi.mock('@/lib/firestore/feedbacks', () => ({ createFeedback: vi.fn() }));
vi.mock('browser-image-compression', () => ({ default: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({
    useAuth: () => ({
        user: { uid: 'u1', email: 'a@b.com' },
        userData: { name: '홍길동', organizationId: 'org-1' },
    }),
}));
vi.mock('@/components/common/AskAIModal', () => ({ default: () => null }));

import FeedbackForm from '@/components/common/FeedbackForm';

describe('FeedbackForm 접근성', () => {
    beforeEach(() => vi.clearAllMocks());

    it('내용 패널이 aria-modal 대화상자다', () => {
        render(<FeedbackForm onClose={vi.fn()} />);

        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        // 제목이 접근성 이름으로 연결돼 있어야 한다
        expect(dialog).toHaveAccessibleName('개발자에게 건의하기');
    });

    it('화면 전체를 덮는 백드롭이 탭 순서에 끼지 않는다', () => {
        render(<FeedbackForm onClose={vi.fn()} />);

        // 백드롭이 버튼으로 노출되면 스크린리더가 "버튼"으로 읽고 탭이 걸린다.
        // 닫기 버튼은 헤더의 실제 버튼 하나뿐이어야 한다.
        const buttons = screen.getAllByRole('button');
        for (const btn of buttons) {
            expect(btn.className).not.toMatch(/fixed inset-0/);
        }
    });

    it('백드롭 클릭은 여전히 닫는다', () => {
        const onClose = vi.fn();
        render(<FeedbackForm onClose={onClose} />);

        // 대화상자의 부모가 백드롭 — presentation이라 role로 못 잡으므로 DOM으로 접근
        const backdrop = screen.getByRole('dialog').parentElement!;
        expect(backdrop.className).toMatch(/fixed inset-0/);

        fireEvent.click(backdrop);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('패널 내부 클릭은 닫지 않는다 — 백드롭으로 전파되지 않아야 한다', () => {
        const onClose = vi.fn();
        render(<FeedbackForm onClose={onClose} />);

        fireEvent.click(screen.getByRole('dialog'));
        expect(onClose).not.toHaveBeenCalled();
    });

    it('헤더 닫기 버튼은 접근성 이름을 가진다', () => {
        const onClose = vi.fn();
        render(<FeedbackForm onClose={onClose} />);

        fireEvent.click(screen.getByRole('button', { name: '닫기' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
