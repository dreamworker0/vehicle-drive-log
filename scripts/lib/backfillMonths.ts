/**
 * backfillMonthlyStats 스크립트의 인자 해석 — 재집계할 최근 개월 수
 *
 * 예전 콜러블과 같은 규칙이다: 지정하지 않으면 6개월(분석 대시보드 기본 창),
 * 숫자는 내림한 뒤 1~24로 자른다. 잘못된 값은 기본값으로 돌린다.
 */
export const DEFAULT_BACKFILL_MONTHS = 6;
export const MAX_BACKFILL_MONTHS = 24;

export function parseBackfillMonths(argv: readonly string[]): number {
    const raw = argv.find((a) => a.startsWith('--months='))?.slice('--months='.length);
    const n = Number(raw);
    if (raw === undefined || raw === '' || !Number.isFinite(n)) return DEFAULT_BACKFILL_MONTHS;
    return Math.min(MAX_BACKFILL_MONTHS, Math.max(1, Math.floor(n)));
}
