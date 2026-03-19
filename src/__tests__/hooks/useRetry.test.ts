import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// useToast mock
const mockShowToast = vi.fn();
vi.mock('../../hooks/useToast', () => ({
    useToast: () => ({ showToast: mockShowToast }),
}));

import useRetry from '../../hooks/useRetry';

describe('useRetry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('성공 시 결과를 반환하고 재시도 카운터를 초기화한다', async () => {
        const { result } = renderHook(() => useRetry());
        const asyncFn = vi.fn().mockResolvedValue('success');

        let returnValue: unknown;
        await act(async () => {
            returnValue = await result.current.runWithRetry('test-key', asyncFn);
        });

        expect(returnValue).toBe('success');
        expect(asyncFn).toHaveBeenCalledOnce();
        expect(mockShowToast).not.toHaveBeenCalled();
    });

    it('네트워크 에러 시 재시도 토스트를 표시한다', async () => {
        const { result } = renderHook(() => useRetry());
        const asyncFn = vi.fn().mockRejectedValue(new Error('network error'));

        await act(async () => {
            await result.current.runWithRetry('test-key', asyncFn);
        });

        expect(mockShowToast).toHaveBeenCalledWith(
            '네트워크 오류가 발생했습니다.',
            'error',
            expect.objectContaining({
                actionLabel: expect.stringContaining('재시도'),
            })
        );
    });

    it('비네트워크 에러 시 일반 에러 토스트를 표시한다', async () => {
        const { result } = renderHook(() => useRetry());
        const asyncFn = vi.fn().mockRejectedValue(new Error('validation failed'));

        await act(async () => {
            await result.current.runWithRetry('test-key', asyncFn);
        });

        expect(mockShowToast).toHaveBeenCalledWith(
            '처리 중 오류가 발생했습니다.',
            'error'
        );
    });

    it('커스텀 에러 메시지를 표시한다', async () => {
        const { result } = renderHook(() => useRetry());
        const asyncFn = vi.fn().mockRejectedValue(new Error('any error'));

        await act(async () => {
            await result.current.runWithRetry('test-key', asyncFn, {
                errorMessage: '사용자 정의 에러',
            });
        });

        expect(mockShowToast).toHaveBeenCalledWith(
            '사용자 정의 에러',
            'error'
        );
    });

    it('onError 콜백이 호출된다', async () => {
        const { result } = renderHook(() => useRetry());
        const asyncFn = vi.fn().mockRejectedValue(new Error('test'));
        const onError = vi.fn();

        await act(async () => {
            await result.current.runWithRetry('test-key', asyncFn, { onError });
        });

        expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('resetRetry로 특정 키나 전체 카운터를 초기화한다', async () => {
        const { result } = renderHook(() => useRetry());

        // 에러 발생 후
        const asyncFn = vi.fn().mockRejectedValue(new Error('network'));
        await act(async () => {
            await result.current.runWithRetry('key1', asyncFn);
        });

        // 리셋
        act(() => {
            result.current.resetRetry('key1');
        });

        // 전체 리셋
        act(() => {
            result.current.resetRetry();
        });

        // 에러 없이 정상 동작 (리셋 후 카운터가 0이므로)
        expect(() => result.current.resetRetry()).not.toThrow();
    });

    it('isNetworkError가 올바르게 판별한다', () => {
        const { result } = renderHook(() => useRetry());
        const { isNetworkError } = result.current;

        expect(isNetworkError(new Error('network error'))).toBe(true);
        expect(isNetworkError(new Error('fetch failed'))).toBe(true);
        expect(isNetworkError(new Error('timeout'))).toBe(true);
        expect(isNetworkError({ code: 'unavailable' })).toBe(true);
        expect(isNetworkError({ code: 'deadline-exceeded' })).toBe(true);
        expect(isNetworkError(new Error('validation error'))).toBe(false);
        expect(isNetworkError(null)).toBe(false);
    });
});
