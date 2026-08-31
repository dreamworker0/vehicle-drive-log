/**
 * 인쇄 페이지 높이 기반 행 분할 테스트
 *
 * 고정 행 수(19행) 분할은 목적지 주소가 길어 행이 2~3줄이 되면 용지를 넘겼다 — 21건이
 * 용지 3장으로 나가던 문제다. 여기서는 "어떤 높이 조합이 와도 한 장을 넘기지 않는다"를
 * 불변식으로 고정한다. 실측은 브라우저에서만 되므로 분할 계산만 순수 함수로 검증한다.
 */
import { describe, it, expect } from 'vitest';
import { paginateByHeight, PAGE_CONTENT_PX, type PageMetrics } from '../../../lib/pdf/pageFit';

/** 실측값을 흉내낸 기본 지표 — 실제 스타일에서 나오는 값에 맞췄다 */
function metrics(rowHeights: number[], overhead = 133): PageMetrics {
    return { overhead, rowHeights, subtotalHeight: 22, totalHeight: 22, emptyRowHeight: 22 };
}

/** paginateByHeight가 내부적으로 쓰는 사용 가능 높이 */
function availableHeight(overhead = 133) {
    return PAGE_CONTENT_PX - 8 - overhead;
}

/** 페이지에 실제로 들어간 높이 (데이터 행 + 빈 행 + 소계 + 마지막이면 합계) */
function usedHeight(m: PageMetrics, slice: { start: number; count: number; emptyCount: number }, isLast: boolean) {
    const rows = m.rowHeights.slice(slice.start, slice.start + slice.count).reduce((a, b) => a + b, 0);
    return rows + slice.emptyCount * m.emptyRowHeight + m.subtotalHeight + (isLast ? m.totalHeight : 0);
}

describe('paginateByHeight — 용지 넘침 방지', () => {
    it('어떤 높이 조합에서도 페이지가 용지 한 장을 넘지 않는다', () => {
        // 1줄(22) · 2줄(31) · 3줄(44)이 섞인 실제와 비슷한 분포
        const heights = Array.from({ length: 60 }, (_, i) => [22, 31, 44, 31, 22, 44][i % 6]);
        const m = metrics(heights);

        const slices = paginateByHeight(m);

        expect(slices.length).toBeGreaterThan(1);
        slices.forEach((slice, i) => {
            expect(usedHeight(m, slice, i === slices.length - 1)).toBeLessThanOrEqual(availableHeight());
        });
    });

    it('행이 전부 1줄이면 고정 19행보다 많이 담는다', () => {
        const m = metrics(Array.from({ length: 40 }, () => 22));

        const slices = paginateByHeight(m);

        // 1줄 행만 있으면 한 장에 24행이 들어간다 — 19로 고정하면 그만큼 용지를 낭비했다
        expect(slices[0].count).toBeGreaterThan(19);
        expect(usedHeight(m, slices[0], false)).toBeLessThanOrEqual(availableHeight());
    });

    it('행이 전부 2줄이면 페이지당 행 수가 19 아래로 줄어든다', () => {
        const m = metrics(Array.from({ length: 40 }, () => 31));

        const slices = paginateByHeight(m);

        // 19행 × 31px = 589px > 562px — 예전에는 이 조합이 다음 장으로 밀렸다
        expect(slices[0].count).toBeLessThan(19);
        expect(usedHeight(m, slices[0], false)).toBeLessThanOrEqual(availableHeight());
    });
});

describe('paginateByHeight — 행 범위와 빈 행', () => {
    it('모든 행을 빠뜨리지 않고 순서대로 담는다', () => {
        const heights = Array.from({ length: 47 }, (_, i) => 22 + (i % 3) * 11);
        const m = metrics(heights);

        const slices = paginateByHeight(m);

        // 시작 인덱스가 이어져야 일련번호가 페이지를 넘어 연속된다
        let expectedStart = 0;
        slices.forEach(slice => {
            expect(slice.start).toBe(expectedStart);
            expectedStart += slice.count;
        });
        expect(expectedStart).toBe(heights.length);
    });

    it('빈 행을 채워도 용지를 넘지 않는다', () => {
        const m = metrics(Array.from({ length: 5 }, () => 22));

        const [only] = paginateByHeight(m);

        expect(only.emptyCount).toBeGreaterThan(0);
        expect(usedHeight(m, only, true)).toBeLessThanOrEqual(availableHeight());
    });

    it('데이터가 없으면 페이지도 없다', () => {
        expect(paginateByHeight(metrics([]))).toEqual([]);
    });
});

describe('paginateByHeight — 마지막 페이지 합계', () => {
    it('마지막 페이지가 합계를 못 담으면 행을 다음 장으로 넘긴다', () => {
        // 두 행(260 + 260 = 520)은 소계까지는 들어가지만(542) 합계까지는 넘친다(564 > 562)
        const m = metrics([260, 260]);

        const slices = paginateByHeight(m);

        expect(slices).toHaveLength(2);
        expect(slices[0].count).toBe(1);
        expect(slices[1].count).toBe(1);
        expect(usedHeight(m, slices[1], true)).toBeLessThanOrEqual(availableHeight());
    });
});

describe('paginateByHeight — 극단값', () => {
    it('한 행이 용지보다 높아도 그 행을 담아 진행한다', () => {
        // 담지 않으면 진행이 없어 무한 루프가 된다 — 넘치더라도 인쇄는 끝나야 한다
        const m = metrics([900, 22]);

        const slices = paginateByHeight(m);

        expect(slices[0].count).toBe(1);
        expect(slices.reduce((sum, s) => sum + s.count, 0)).toBe(2);
    });

    it('머리글만으로 용지를 넘기면 분할을 포기한다', () => {
        // 호출부가 고정 행 수 분할로 되돌린다
        expect(paginateByHeight(metrics([22, 22], PAGE_CONTENT_PX))).toEqual([]);
    });
});
