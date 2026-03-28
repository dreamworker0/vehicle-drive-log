/**
 * useRetry — 네트워크 에러 감지 + 자동 재시도 유틸리티 훅
 * 비동기 작업 실패 시 Toast로 재시도 버튼을 표시한다.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useToast } from './useToast';

interface RetryRunOptions {
    errorMessage?: string;
    onError?: (err: unknown) => void;
}

/**
 * 네트워크/서버 에러인지 판별
 */
function isNetworkError(err: unknown) {
    if (!err) return false;
    const e = err as { message?: string; code?: string };
    const msg = (e.message || '').toLowerCase();
    // 네트워크 오류 패턴
    if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout')) return true;
    if (msg.includes('failed to get document') || msg.includes('unavailable')) return true;
    // Firebase 에러 코드
    if (e.code === 'unavailable' || e.code === 'deadline-exceeded') return true;
    if (e.code === 'resource-exhausted' || e.code === 'aborted') return true;
    return false;
}

/**
 * @param {Object} options
 * @param {number} [options.maxRetries=2] - 최대 재시도 횟수
 * @param {string} [options.retryLabel='재시도'] - 재시도 버튼 텍스트
 */
export default function useRetry({ maxRetries = 2, retryLabel = '재시도' } = {}) {
    const { showToast } = useToast();
    const retryCountRef = useRef(new Map());
    // 안정적인 최신 함수 참조를 위한 ref (순환 참조 방지)
    const runWithRetryRef = useRef<((key: string, asyncFn: () => Promise<unknown>, opts?: RetryRunOptions) => Promise<unknown>) | null>(null);

    /**
     * 비동기 함수를 실행하고, 실패 시 재시도 토스트를 표시한다.
     * @param {string} key - 재시도 카운터 키 (고유 식별자)
     * @param {Function} asyncFn - 실행할 비동기 함수
     * @param {Object} [opts] - 추가 옵션
     * @param {string} [opts.errorMessage] - 커스텀 에러 메시지
     * @param {Function} [opts.onError] - 에러 발생 시 추가 콜백
     * @returns {Promise<*>} asyncFn의 반환값 또는 에러 시 undefined
     */
    const runWithRetry = useCallback(async (key: string, asyncFn: () => Promise<unknown>, opts: RetryRunOptions & { useBackoff?: boolean; baseDelayMs?: number } = {}) => {
        try {
            const currentCount = retryCountRef.current.get(key) || 0;
            // 백오프 옵션이 켜져있고 처음 시도가 아니면 지연
            if (opts.useBackoff && currentCount > 0) {
                const delayMs = (opts.baseDelayMs || 1000) * Math.pow(2, currentCount - 1);
                console.debug(`[useRetry:${key}] ${delayMs}ms 대기 후 재시도 (${currentCount}/${maxRetries})`);
                await new Promise(res => setTimeout(res, delayMs));
            }

            const result = await asyncFn();
            // 성공 시 재시도 카운터 초기화
            retryCountRef.current.delete(key);
            return result;
        } catch (err) {
            console.error(`[useRetry:${key}]`, err);
            if (opts.onError) opts.onError(err);

            const currentCount = retryCountRef.current.get(key) || 0;

            if (isNetworkError(err) && currentCount < maxRetries) {
                // 네트워크 에러 → 재시도 버튼 표시 또는 자동 백오프 시도
                retryCountRef.current.set(key, currentCount + 1);
                const remaining = maxRetries - currentCount;
                
                // 자동 백오프 모드가 켜져있으면 Toast 대신 바로 재귀 호출 (안전 장치로 maxRetries 내에서만 돎)
                if (opts.useBackoff) {
                    return runWithRetryRef.current?.(key, asyncFn, opts);
                }

                showToast(
                    opts.errorMessage || '네트워크 통신 중입니다.',
                    'error',
                    {
                        duration: 8000,
                        actionLabel: `${retryLabel} (${remaining})`,
                        onAction: () => runWithRetryRef.current?.(key, asyncFn, opts),
                    }
                );
            } else {
                // 비네트워크 에러 또는 재시도 횟수 완전 초과 (포기)
                retryCountRef.current.delete(key);
                showToast(
                    opts.errorMessage || (currentCount >= maxRetries 
                        ? '일시적인 네트워크 오류가 지속됩니다. 잠시 후 다시 시도해 주세요.' 
                        : '처리 중 오류가 발생했습니다.'),
                    'error'
                );
            }

            return undefined;
        }
    }, [showToast, maxRetries, retryLabel]);

    // ref에 최신 함수 반영 (렌더 바깥에서 업데이트)
    useEffect(() => { runWithRetryRef.current = runWithRetry; });

    /**
     * 재시도 카운터를 초기화
     */
    const resetRetry = useCallback((key?: string) => {
        if (key) {
            retryCountRef.current.delete(key);
        } else {
            retryCountRef.current.clear();
        }
    }, []);

    return { runWithRetry, resetRetry, isNetworkError };
}

