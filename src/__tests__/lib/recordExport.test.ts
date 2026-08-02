/**
 * recordExport (클라이언트) — 반출 기록 호출
 *
 * 이 헬퍼의 유일한 계약은 "절대 내보내기를 막지 않는다"이다.
 * 감사 쓰기가 실패했다고 사용자가 받아야 할 파일이 사라지면 손실이 훨씬 크다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    callable: vi.fn(),
    httpsCallable: vi.fn(),
    captureError: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
    httpsCallable: (...args: unknown[]) => {
        mocks.httpsCallable(...args);
        return mocks.callable;
    },
}));
vi.mock('../../lib/firebase', () => ({ firebaseFunctions: {}, db: {}, auth: {} }));
vi.mock('../../lib/sentry', () => ({ captureError: mocks.captureError }));

import { recordExport } from '../../lib/audit/recordExport';

beforeEach(() => {
    vi.clearAllMocks();
    mocks.callable.mockResolvedValue({ data: { success: true } });
});

describe('recordExport (클라이언트)', () => {
    it('형식·대상·건수를 보낸다', () => {
        recordExport('excel', 'driveLogs', 42);

        expect(mocks.callable).toHaveBeenCalledTimes(1);
        expect(mocks.callable.mock.calls[0][0]).toMatchObject({
            format: 'excel', dataset: 'driveLogs', recordCount: 42,
        });
    });

    it('반출 식별자는 서버 패턴을 만족하고 호출마다 달라진다', () => {
        recordExport('pdf', 'maintenance', 3);
        recordExport('pdf', 'maintenance', 3);

        const [a, b] = mocks.callable.mock.calls.map((c) => c[0].exportId);
        expect(a).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
        expect(b).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
        // 같은 값이면 두 번째 반출이 첫 번째 문서를 덮어써 기록이 사라진다
        expect(a).not.toBe(b);
    });

    it('데이터 내용이나 검색 조건을 담지 않는다 — 건수·형식·대상뿐이다', () => {
        recordExport('excel', 'fuelLogs', 10);
        expect(Object.keys(mocks.callable.mock.calls[0][0]).sort())
            .toEqual(['dataset', 'exportId', 'format', 'recordCount']);
    });

    it('호출이 거부돼도 throw하지 않는다 — 내보내기를 막으면 안 된다', () => {
        mocks.callable.mockRejectedValue(new Error('permission-denied'));
        expect(() => recordExport('excel', 'driveLogs', 1)).not.toThrow();
    });

    it('callable 생성 자체가 실패해도 throw하지 않는다', () => {
        mocks.httpsCallable.mockImplementation(() => { throw new Error('functions 미초기화'); });
        expect(() => recordExport('excel', 'driveLogs', 1)).not.toThrow();
        expect(mocks.captureError).toHaveBeenCalled();
    });
});
