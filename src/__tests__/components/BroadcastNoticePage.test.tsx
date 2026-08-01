/**
 * BroadcastNoticePage — 전체 기관 일괄 공지 화면
 *
 * 되돌릴 수 없는 대량 발송이라 화면이 지켜야 할 계약을 고정한다.
 *  (1) 대상 확인 전에는 발송할 수 없다
 *  (2) 문안을 고치면 확인 결과가 사라진다 — 확인한 문안과 보내는 문안이 같아야 한다
 *  (3) 확인 대화에서 취소하면 아무것도 보내지 않는다
 *  (4) 미리보기 호출은 dryRun으로만 나간다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    callable: vi.fn(),
    showToast: vi.fn(),
    confirm: vi.fn(),
    captureError: vi.fn(),
}));

vi.mock('firebase/functions', () => ({ httpsCallable: () => mocks.callable }));
vi.mock('../../lib/firebase', () => ({ firebaseFunctions: {}, db: {}, auth: {} }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => ({ confirm: mocks.confirm }) }));
vi.mock('../../lib/sentry', () => ({ captureError: mocks.captureError }));

import BroadcastNoticePage from '../../components/superAdmin/BroadcastNoticePage';

const previewOk = { data: { success: true, dryRun: true, recipientCount: 812, pushableCount: 640 } };
const sendOk = { data: { success: true, dryRun: false, recipientCount: 812, pushSent: 630, pushFailed: 10 } };

const btn = (name: string) => screen.getByRole('button', { name });

beforeEach(() => {
    vi.clearAllMocks();
    mocks.confirm.mockResolvedValue(true);
    mocks.callable.mockResolvedValue(previewOk);
});

describe('BroadcastNoticePage', () => {
    it('약관 개정 공지 문안이 기본값으로 채워진다', () => {
        render(<BroadcastNoticePage />);
        expect(screen.getByLabelText('제목')).toHaveValue('이용약관 개정 안내');
        // 시행일은 상수에서 파생되므로 본문과 어긋날 수 없다
        expect((screen.getByLabelText('내용') as HTMLTextAreaElement).value)
            .toContain('2026년 8월 10일부터 개정 시행됩니다');
    });

    it('대상을 확인하기 전에는 발송 버튼이 잠겨 있다', () => {
        render(<BroadcastNoticePage />);
        expect(btn('발송')).toBeDisabled();
        expect(btn('대상 확인')).toBeEnabled();
    });

    it('대상 확인은 dryRun으로만 호출하고 인원을 보여준다', async () => {
        render(<BroadcastNoticePage />);

        fireEvent.click(btn('대상 확인'));

        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('812명'));
        expect(mocks.callable.mock.calls[0][0]).toMatchObject({ dryRun: true });
        expect(screen.getByRole('status')).toHaveTextContent('640명');
        expect(btn('발송')).toBeEnabled();
    });

    it('내용을 수정하면 확인 결과가 사라지고 발송이 다시 잠긴다', async () => {
        render(<BroadcastNoticePage />);

        fireEvent.click(btn('대상 확인'));
        await waitFor(() => expect(btn('발송')).toBeEnabled());

        fireEvent.change(screen.getByLabelText('제목'), { target: { value: '이용약관 개정 안내!' } });

        // 확인한 문안과 보내는 문안이 달라지는 것이 이 화면에서 가장 위험한 실수다
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(btn('발송')).toBeDisabled();
    });

    it('발송은 dryRun 없이 나가고 결과를 알린다', async () => {
        render(<BroadcastNoticePage />);

        fireEvent.click(btn('대상 확인'));
        await waitFor(() => expect(btn('발송')).toBeEnabled());

        mocks.callable.mockResolvedValue(sendOk);
        fireEvent.click(btn('발송'));

        await waitFor(() => expect(mocks.showToast).toHaveBeenCalled());
        const sendPayload = mocks.callable.mock.calls[1][0];
        expect(sendPayload.dryRun).toBeUndefined();
        expect(sendPayload).toMatchObject({ title: '이용약관 개정 안내' });
        expect(mocks.showToast.mock.calls[0][0]).toContain('812명에게 발송했습니다');
        expect(mocks.showToast.mock.calls[0][0]).toContain('실패 10');
    });

    it('확인 대화에서 취소하면 아무것도 보내지 않는다', async () => {
        mocks.confirm.mockResolvedValue(false);
        render(<BroadcastNoticePage />);

        fireEvent.click(btn('대상 확인'));
        await waitFor(() => expect(btn('발송')).toBeEnabled());

        fireEvent.click(btn('발송'));

        await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
        // 미리보기 1회만 나가고 발송 호출은 없어야 한다
        expect(mocks.callable).toHaveBeenCalledTimes(1);
        expect(mocks.showToast).not.toHaveBeenCalled();
    });

    it('확인 대화에 인원과 취소 불가를 명시한다', async () => {
        render(<BroadcastNoticePage />);

        fireEvent.click(btn('대상 확인'));
        await waitFor(() => expect(btn('발송')).toBeEnabled());
        fireEvent.click(btn('발송'));

        await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
        const opts = mocks.confirm.mock.calls[0][0];
        expect(opts.message).toContain('812명');
        expect(opts.message).toContain('취소할 수 없습니다');
    });

    it('제목이 비면 대상 확인도 막는다', async () => {
        render(<BroadcastNoticePage />);

        fireEvent.change(screen.getByLabelText('제목'), { target: { value: '' } });

        expect(btn('대상 확인')).toBeDisabled();
        expect(btn('발송')).toBeDisabled();
    });

    it('발송이 실패하면 토스트로 알리고 Sentry에 보고한다', async () => {
        render(<BroadcastNoticePage />);

        fireEvent.click(btn('대상 확인'));
        await waitFor(() => expect(btn('발송')).toBeEnabled());

        mocks.callable.mockRejectedValue(new Error('internal'));
        fireEvent.click(btn('발송'));

        await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('공지 발송에 실패했습니다.', 'error'));
        expect(mocks.captureError).toHaveBeenCalled();
    });
});
