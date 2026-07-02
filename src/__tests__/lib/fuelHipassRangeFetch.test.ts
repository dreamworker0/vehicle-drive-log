import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Firebase 모듈 모킹 — limit 인자를 검증하기 위해 호출 인자를 그대로 보존한다.
vi.mock('firebase/firestore', () => ({
    collection: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn((n: number) => ({ _limit: n })),
    getDocs: vi.fn(),
    addDoc: vi.fn(),
    doc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    serverTimestamp: vi.fn(() => new Date()),
}));

vi.mock('../../lib/sentry', () => ({
    captureError: vi.fn(),
}));

vi.mock('../../lib/firebase', () => ({
    db: {},
}));

import { getDocs, limit } from 'firebase/firestore';
import { getFuelLogs } from '../../lib/firestore/fuelLogs';
import { getAllHipassCharges } from '../../lib/firestore/hipassCharges';

const mockDocs = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ id: `doc-${i}`, data: () => ({ date: '2026-07-01' }) }));

describe('기간 조회 상한 (내보내기·월간 보고서 조인 누락 방지)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getDocs).mockResolvedValue({ docs: mockDocs(3) } as never);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('getFuelLogs', () => {
        it('기간(since/until) 지정 시 상한 5,000건으로 조회한다', async () => {
            await getFuelLogs('org-1', null, { since: '2026-01-01', until: '2026-03-31' });
            expect(limit).toHaveBeenCalledWith(5000);
        });

        it('since만 지정해도 상한 5,000건을 적용한다', async () => {
            await getFuelLogs('org-1', 'vehicle-1', { since: '2026-01-01' });
            expect(limit).toHaveBeenCalledWith(5000);
        });

        it('기간 미지정(화면 목록) 조회는 기존 200건 상한을 유지한다', async () => {
            await getFuelLogs('org-1');
            expect(limit).toHaveBeenCalledWith(200);
        });

        it('기간 조회가 상한에 도달하면 경고를 남긴다 (조용한 누락 방지)', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            vi.mocked(getDocs).mockResolvedValue({ docs: mockDocs(5000) } as never);
            const result = await getFuelLogs('org-1', null, { since: '2020-01-01', until: '2026-12-31' });
            expect(result).toHaveLength(5000);
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('상한'));
        });
    });

    describe('getAllHipassCharges', () => {
        it('기간(since/until) 지정 시 상한 5,000건으로 조회한다', async () => {
            await getAllHipassCharges('org-1', { since: new Date('2026-01-01'), until: new Date('2026-03-31') });
            expect(limit).toHaveBeenCalledWith(5000);
        });

        it('기간 미지정 조회는 기존 200건 상한을 유지한다', async () => {
            await getAllHipassCharges('org-1');
            expect(limit).toHaveBeenCalledWith(200);
        });
    });
});
