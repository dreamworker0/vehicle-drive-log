/**
 * scripts/backfillMonthlyStats.ts 인자 해석 — 예전 콜러블(backfillMonthlyStats)과 같은 규칙인지
 * (기본 6개월, 내림 후 1~24로 자름)
 */
import { describe, expect, it } from 'vitest';
import { parseBackfillMonths, DEFAULT_BACKFILL_MONTHS } from '../lib/backfillMonths';

describe('parseBackfillMonths', () => {
    it('지정하지 않으면 기본 6개월', () => {
        expect(parseBackfillMonths(['node', 'x.ts', '--apply'])).toBe(DEFAULT_BACKFILL_MONTHS);
        expect(DEFAULT_BACKFILL_MONTHS).toBe(6);
    });

    it.each([
        ['--months=12', 12],
        ['--months=0', 1],
        ['--months=-3', 1],
        ['--months=99', 24],
        ['--months=7.9', 7],
        ['--months=abc', 6],
        ['--months=', 6],
    ])('%s → %i', (arg, expected) => {
        expect(parseBackfillMonths(['--apply', arg])).toBe(expected);
    });
});
