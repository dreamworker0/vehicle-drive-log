import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { ToastProviderWrapper } from '../../hooks/ToastProvider';
import { useToast } from '../../hooks/useToast';

// 테스트용 컴포넌트
function TestComponent() {
    const { showToast } = useToast();
    return (
        <div>
            <button onClick={() => showToast('성공 메시지', 'success')}>성공</button>
            <button onClick={() => showToast('에러 메시지', 'error')}>에러</button>
            <button onClick={() => showToast('경고 메시지', 'warning')}>경고</button>
        </div>
    );
}

describe('useToast', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        // 남은 토스트 타이머를 모두 실행하여 이전 테스트의 토스트 정리
        act(() => {
            vi.runOnlyPendingTimers();
        });
        cleanup();
        vi.useRealTimers();
    });

    it('성공 토스트를 표시한다', async () => {
        render(
            <ToastProviderWrapper>
                <TestComponent />
            </ToastProviderWrapper>
        );

        await act(async () => {
            screen.getByText('성공').click();
        });

        expect(screen.getByText('성공 메시지')).toBeInTheDocument();
    });

    it('에러 토스트를 표시한다', async () => {
        render(
            <ToastProviderWrapper>
                <TestComponent />
            </ToastProviderWrapper>
        );

        await act(async () => {
            screen.getByText('에러').click();
        });

        expect(screen.getByText('에러 메시지')).toBeInTheDocument();
    });

    it('3초 후 토스트가 자동으로 사라진다', async () => {
        render(
            <ToastProviderWrapper>
                <TestComponent />
            </ToastProviderWrapper>
        );

        await act(async () => {
            screen.getByText('성공').click();
        });

        expect(screen.getByText('성공 메시지')).toBeInTheDocument();

        await act(async () => {
            vi.advanceTimersByTime(4000);
        });

        expect(screen.queryByText('성공 메시지')).not.toBeInTheDocument();
    });
});
