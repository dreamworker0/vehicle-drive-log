/**
 * callableRetry — 콜러블 호출의 대기 시간·재시도 규약
 *
 * 고정하는 계약:
 *  (1) SDK 기본 70초가 아니라 짧은 대기 시간을 명시해서 부른다
 *  (2) 일시적 실패(deadline-exceeded 등)만 다시 부른다 — 거부는 다시 불러도 같은 답이다
 *  (3) 재시도는 같은 payload로 부른다 (서버 문서 ID가 payload에서 나오므로 멱등해야 한다)
 *  (4) 전부 실패하면 마지막 에러를 던진다 — 보고 여부는 호출부가 정한다
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    callable: vi.fn(),
    httpsCallable: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
    httpsCallable: (...args: unknown[]) => {
        mocks.httpsCallable(...args);
        return mocks.callable;
    },
}));
vi.mock('../../lib/firebase', () => ({ firebaseFunctions: {} }));

import { callWithRetry, isTransientCallableError, DEFAULT_CALL_TIMEOUT_MS } from '../../lib/callableRetry';

/** SDK가 시간 초과 시 던지는 것과 같은 모양 (code·message 모두 'deadline-exceeded') */
function deadlineExceeded() {
    return Object.assign(new Error('deadline-exceeded'), { code: 'functions/deadline-exceeded' });
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.callable.mockResolvedValue({ data: { success: true } });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('isTransientCallableError', () => {
    it('SDK 시간 초과(functions/deadline-exceeded)를 일시적으로 본다', () => {
        expect(isTransientCallableError(deadlineExceeded())).toBe(true);
    });

    it('서비스 접두사가 없는 코드도 받는다', () => {
        expect(isTransientCallableError({ code: 'unavailable' })).toBe(true);
        expect(isTransientCallableError({ code: 'internal' })).toBe(true);
    });

    it('거부는 일시적이지 않다 — 다시 불러도 같은 답이 온다', () => {
        expect(isTransientCallableError({ code: 'functions/invalid-argument' })).toBe(false);
        expect(isTransientCallableError({ code: 'functions/permission-denied' })).toBe(false);
        // 한도 초과에 재시도를 걸면 남은 한도만 깎는다
        expect(isTransientCallableError({ code: 'functions/resource-exhausted' })).toBe(false);
    });

    it('코드가 없는 네트워크 에러는 메시지로 판별한다', () => {
        expect(isTransientCallableError(new Error('Failed to fetch'))).toBe(true);
        expect(isTransientCallableError(new Error('network error'))).toBe(true);
        expect(isTransientCallableError(new Error('그 밖의 오류'))).toBe(false);
        expect(isTransientCallableError(null)).toBe(false);
    });
});

describe('callWithRetry', () => {
    it('SDK 기본값(70초) 대신 짧은 대기 시간을 명시해서 부른다', async () => {
        await callWithRetry('recordSession', { sessionId: 'abcdefgh' });

        expect(mocks.httpsCallable.mock.calls[0][2]).toEqual({ timeout: DEFAULT_CALL_TIMEOUT_MS });
        expect(DEFAULT_CALL_TIMEOUT_MS).toBeLessThan(70_000);
    });

    it('성공하면 data를 그대로 돌려주고 다시 부르지 않는다', async () => {
        mocks.callable.mockResolvedValue({ data: { ok: 1 } });

        await expect(callWithRetry('recordExport', {})).resolves.toEqual({ ok: 1 });
        expect(mocks.callable).toHaveBeenCalledTimes(1);
    });

    it('시간 초과면 같은 payload로 다시 부른다 — 두 번째에 성공하면 그 값을 쓴다', async () => {
        mocks.callable
            .mockRejectedValueOnce(deadlineExceeded())
            .mockResolvedValueOnce({ data: { ok: 2 } });

        const payload = { sessionId: 'abcdefgh' };
        const promise = callWithRetry('recordSession', payload);
        await vi.advanceTimersByTimeAsync(5_000);

        await expect(promise).resolves.toEqual({ ok: 2 });
        expect(mocks.callable).toHaveBeenCalledTimes(2);
        // 문서 ID가 payload에서 나오므로 값이 바뀌면 재시도가 중복 기록이 된다
        expect(mocks.callable.mock.calls[1][0]).toEqual(payload);
    });

    it('계속 실패하면 attempts 횟수만큼만 부르고 마지막 에러를 던진다', async () => {
        const err = deadlineExceeded();
        mocks.callable.mockRejectedValue(err);

        const promise = callWithRetry('recordSession', {}, { attempts: 3, baseDelayMs: 100 });
        const assertion = expect(promise).rejects.toBe(err);
        await vi.advanceTimersByTimeAsync(1_000);
        await assertion;

        expect(mocks.callable).toHaveBeenCalledTimes(3);
    });

    it('거부는 재시도하지 않고 즉시 던진다', async () => {
        const err = Object.assign(new Error('반출 형식이 올바르지 않습니다.'), {
            code: 'functions/invalid-argument',
        });
        mocks.callable.mockRejectedValue(err);

        await expect(callWithRetry('recordExport', {})).rejects.toBe(err);
        expect(mocks.callable).toHaveBeenCalledTimes(1);
    });

    it('httpsCallable 생성 자체가 실패해도 동기 예외가 아니라 reject로 나간다', async () => {
        mocks.httpsCallable.mockImplementation(() => { throw new Error('functions 미초기화'); });

        // 동기 throw면 fire-and-forget 호출부의 .catch()가 받지 못한다
        let promise: Promise<unknown> | undefined;
        expect(() => { promise = callWithRetry('recordExport', {}); }).not.toThrow();
        await expect(promise).rejects.toThrow('functions 미초기화');
    });
});
