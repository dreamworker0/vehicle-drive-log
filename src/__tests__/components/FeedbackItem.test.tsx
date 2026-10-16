import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FeedbackItem from '@/components/superAdmin/FeedbackItem';
import type { Feedback } from '@/types';

/**
 * 의견 관리 — 답변은 시스템 관리자가 직접 쓴다.
 * AI 답변 초안은 2026-10-16 운영자 요청으로 없앴다. 그 전에 만들어진 문서에 남은 aiDraft도
 * 답변 칸에 채우지 않는다.
 */
const baseProps = {
    expandedId: 'fb1',
    orgNames: {},
    copiedMessage: null,
    sendingReply: null,
    replyError: null,
    onToggleExpand: vi.fn(),
    onToggleResolve: vi.fn(),
    onSetDeleteTarget: vi.fn(),
    onSetSelectedImage: vi.fn(),
    onCopyMessage: vi.fn(),
    onSendReply: vi.fn(),
};

// 옛 문서 모양 — 타입에서 뺀 aiDraft가 데이터에는 남아 있을 수 있다
const legacyFeedback = {
    id: 'fb1',
    authorUid: 'u1',
    content: '',
    message: '수정 후 목록으로 돌아오면 좋겠어요',
    status: 'unread',
    aiDraft: '안녕하세요. 김종원입니다. 초안은 인공지능이 작성합니다.',
} as unknown as Feedback;

describe('FeedbackItem — 답변 작성', () => {
    it('AI 답변 초안 영역 없이 빈 답변 칸을 보여 준다(옛 aiDraft도 채우지 않는다)', () => {
        render(<FeedbackItem {...baseProps} fb={legacyFeedback} />);

        expect(screen.queryByText(/AI 답변 초안/)).toBeNull();
        expect(screen.queryByText('새로 생성')).toBeNull();
        const textarea = screen.getByLabelText(/답변 작성/) as HTMLTextAreaElement;
        expect(textarea.value).toBe('');
        expect(screen.getByRole('button', { name: /답변 발송/ })).toBeDisabled();
    });

    it('직접 쓴 답변을 발송한다', () => {
        const onSendReply = vi.fn();
        render(<FeedbackItem {...baseProps} onSendReply={onSendReply} fb={legacyFeedback} />);

        fireEvent.change(screen.getByLabelText(/답변 작성/), { target: { value: '반영했습니다.' } });
        fireEvent.click(screen.getByRole('button', { name: /답변 발송/ }));

        expect(onSendReply).toHaveBeenCalledWith('fb1', '반영했습니다.');
    });
});
