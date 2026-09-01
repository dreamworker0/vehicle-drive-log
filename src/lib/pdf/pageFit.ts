/**
 * 인쇄 페이지 높이에 맞춘 표 행 분할
 *
 * **고정 행 수로는 안 되는 이유** — `.log-table tbody td`의 `height: 22px`는 *최소* 높이다.
 * 목적지에 주소가 들어가면 `word-break: break-all`로 2~3줄이 되어 행이 31~44px까지 자란다.
 * 19행으로 미리 잘라 `page-break-after: always` 컨테이너에 담으면, 그 묶음이 용지 한 장의
 * 내용 높이(약 703px)를 넘겨 뒤쪽 행이 다음 장으로 밀린다. 밀린 장에는 제목도 결재란도
 * 머리글도 없다 — 21건이 용지 3장으로 나가던 문제가 정확히 이것이다.
 *
 * 그래서 실제 렌더 높이를 재고, 남은 높이만큼만 담는다.
 */

/** mm → CSS px (96dpi) */
const mmToPx = (mm: number) => Math.floor((mm * 96) / 25.4);

/** A4 가로 한 장의 내용 높이(px) — 210mm − 위아래 여백 24mm, CSS 96dpi 기준 */
export const PAGE_CONTENT_PX = mmToPx(210 - 24);

/**
 * 인쇄 내용 영역 — 용지 크기에서 `@page` 여백을 뺀 값.
 *
 * 문서마다 용지 방향과 여백이 달라 상수 하나로는 안 된다. 폭은 **측정용 iframe 폭**으로
 * 쓰이는데, 인쇄 내용 폭과 다르면 목적지 칸이 인쇄와 다른 줄 수로 접혀 측정이 무의미해진다.
 */
export interface PageBox {
    /** 내용 높이(px) — 이 높이를 넘기면 다음 장으로 밀린다 */
    heightPx: number;
    /** 내용 폭(CSS 길이) */
    width: string;
}

/** A4 가로 · 여백 12mm 10mm — 운행일지와 pdfEngine 계열 보고서 3종 */
export const A4_LANDSCAPE_BOX: PageBox = { heightPx: PAGE_CONTENT_PX, width: '277mm' };

/** A4 세로 · 여백 15/14/12/14mm — 일별 운행일지 */
export const A4_PORTRAIT_DAILY_BOX: PageBox = { heightPx: mmToPx(297 - 15 - 12), width: `${210 - 28}mm` };

/** 인쇄 시 반올림으로 1px이 넘쳐 빈 장이 붙는 것을 막는 여유 */
const SAFETY_PX = 8;

/** 실측한 높이들 (px) */
export interface PageMetrics {
    /** 표 위 고정 요소(제목·결재란·기관/기간) + thead 높이 */
    overhead: number;
    /** 데이터 행별 실제 높이 — 정렬된 순서 */
    rowHeights: number[];
    /** 소계 행 높이 — 모든 페이지에 붙는다 */
    subtotalHeight: number;
    /** 합계 행 높이 — 마지막 페이지에만 붙는다 */
    totalHeight: number;
    /** 빈 행 한 칸의 높이 */
    emptyRowHeight: number;
}

/**
 * 측정용 문서 tbody의 **꼬리 행 구성** — 데이터 행 뒤에는 빈 행 1개(기준 높이)가 오고,
 * 그 뒤에 붙는 합계 행은 문서 종류마다 다르다. 운행일지는 소계(모든 장) + 합계(마지막 장)이고,
 * pdfEngine 계열 보고서(주유·하이패스·정비)는 페이지 소계만 있다.
 */
export interface TrailingRowSpec {
    /** 모든 페이지에 붙는 합계 행(소계)이 있는지 */
    subtotal: boolean;
    /** 마지막 페이지에만 붙는 합계 행(총 합계)이 있는지 */
    total: boolean;
}

/** measurePageMetrics 조절값 */
export interface MeasureOptions {
    /** 데이터 행 뒤 합계 행 구성 (기본: 소계 + 합계) */
    trailing?: TrailingRowSpec;
    /** 용지 내용 영역 (기본: A4 가로) */
    box?: PageBox;
}

/** 한 페이지에 담을 범위 */
export interface PageSlice {
    /** 전체 정렬 배열에서의 시작 인덱스 (일련번호가 페이지를 넘어 이어지게 한다) */
    start: number;
    /** 담을 데이터 행 수 */
    count: number;
    /** 아래를 채울 빈 행 수 — 양식 높이를 유지한다 */
    emptyCount: number;
}

/** paginateByHeight 조절값 */
export interface PaginateOptions {
    /** 용지 내용 영역 (기본: A4 가로) */
    box?: PageBox;
    /**
     * 페이지당 최대 데이터 행 수 — **종이 양식의 칸 수가 정해진 문서**에서 쓴다.
     * 일별 운행일지는 12칸이 양식의 모양이라, 높이가 남아도 13칸으로 늘리지 않는다.
     */
    maxRows?: number;
    /**
     * 빈 행을 이 개수(데이터 행 + 빈 행)까지만 채운다. 기본은 남은 높이를 모두 채운다.
     * 높이가 부족하면 이 값보다 적게 채운다 — 양식 모양보다 용지 넘침 방지가 먼저다.
     */
    fillTo?: number;
}

/**
 * 실측 높이로 페이지를 나눈다.
 *
 * 모든 페이지에 소계가 붙고 마지막 페이지에만 합계가 더 붙으므로, 채우는 동안에는 소계만
 * 예약하고 마지막 페이지가 합계까지 못 담으면 그때 행을 다음 장으로 넘긴다. 합계 높이를
 * 모든 페이지에 미리 예약하면 페이지마다 행 한 칸을 놀리게 된다.
 */
export function paginateByHeight(metrics: PageMetrics, options: PaginateOptions = {}): PageSlice[] {
    const { box = A4_LANDSCAPE_BOX, maxRows, fillTo } = options;
    const { overhead, rowHeights, subtotalHeight, totalHeight, emptyRowHeight } = metrics;
    const total = rowHeights.length;
    if (total === 0) return [];

    const avail = box.heightPx - SAFETY_PX - overhead;
    // 머리글만으로 용지를 넘기는 비정상 값(음수 높이 등)에서는 분할을 포기한다 — 호출부가 되돌린다.
    if (avail <= 0) return [];

    const slices: { start: number; count: number; used: number }[] = [];
    let cursor = 0;

    while (cursor < total) {
        let used = 0;
        let count = 0;
        while (cursor + count < total) {
            // 양식 칸 수가 정해진 문서는 높이가 남아도 그 이상 담지 않는다
            if (maxRows !== undefined && count >= maxRows) break;
            const next = rowHeights[cursor + count];
            // 한 행조차 안 들어가는 극단(아주 긴 주소 + 좁은 용지)에서도 최소 한 행은 담는다.
            // 안 그러면 진행이 없어 무한 루프가 된다 — 그 행은 넘치더라도 인쇄는 끝나야 한다.
            if (count > 0 && used + next + subtotalHeight > avail) break;
            used += next;
            count += 1;
        }
        slices.push({ start: cursor, count, used });
        cursor += count;
    }

    // 마지막 페이지에 합계가 못 들어가면 행을 뒤로 넘긴다 (보통 한 번으로 끝난다)
    let last = slices[slices.length - 1];
    while (last.count > 1 && last.used + subtotalHeight + totalHeight > avail) {
        const moved = last.start + last.count - 1;
        last.count -= 1;
        last.used -= rowHeights[moved];
        slices.push({ start: moved, count: 1, used: rowHeights[moved] });
        last = slices[slices.length - 1];
    }

    return slices.map((slice, idx) => {
        const reserve = subtotalHeight + (idx === slices.length - 1 ? totalHeight : 0);
        const remaining = avail - slice.used - reserve;
        // 남은 높이가 허용하는 만큼 채우되, 양식 칸 수(fillTo)가 정해져 있으면 거기까지만 채운다
        const byHeight = emptyRowHeight > 0 ? Math.floor(remaining / emptyRowHeight) : 0;
        const byForm = fillTo === undefined ? byHeight : fillTo - slice.count;
        return {
            start: slice.start,
            count: slice.count,
            emptyCount: Math.max(0, Math.min(byHeight, byForm)),
        };
    });
}

/**
 * 인쇄용 HTML을 숨은 iframe에 그려 실제 높이를 잰다.
 *
 * 인쇄 창이 아니라 iframe에서 재는 이유 — 인쇄 창은 화면 폭(1100px)이라 줄바꿈이 인쇄와
 * 다르다. iframe 폭을 **인쇄 내용 폭과 같게**(`box.width` — A4 가로 277mm, 일별일지 182mm)
 * 맞춰야 목적지 칸이 인쇄와 같은 줄 수로 접힌다.
 *
 * 잴 수 없는 환경(jsdom, iframe 차단 등)에서는 `null`을 돌려 호출부가 고정 분할로 되돌아간다.
 *
 * @param docHtml 측정용 문서 — 전체 행을 한 페이지에 담고, 빈 행 1개와 `trailing`이 선언한 합계 행이 뒤따라야 한다
 * @param dataRowCount 데이터 행 수 (tbody에서 데이터 행과 부속 행을 가르는 기준)
 * @param options `trailing`(기본: 운행일지 — 소계 + 합계) · `box`(기본: A4 가로)
 */
export function measurePageMetrics(
    docHtml: string,
    dataRowCount: number,
    options: MeasureOptions = {},
): PageMetrics | null {
    const { trailing = { subtotal: true, total: true }, box = A4_LANDSCAPE_BOX } = options;
    if (typeof document === 'undefined' || !document.body) return null;

    let frame: HTMLIFrameElement | null = null;
    try {
        frame = document.createElement('iframe');
        frame.setAttribute('aria-hidden', 'true');
        frame.setAttribute('tabindex', '-1');
        frame.style.cssText = [
            'position:fixed', 'left:-10000px', 'top:0',
            `width:${box.width}`, 'height:3000px', 'border:0', 'visibility:hidden',
        ].join(';');
        document.body.appendChild(frame);

        const doc = frame.contentDocument;
        if (!doc) return null;
        doc.open();
        doc.write(docHtml);
        doc.close();

        // 스크롤바가 뜨면 내용 폭이 15px쯤 줄어 줄바꿈이 인쇄와 달라진다. 높이는 그대로 계산된다.
        if (doc.documentElement) doc.documentElement.style.overflow = 'hidden';
        if (doc.body) doc.body.style.overflow = 'hidden';

        const page = doc.querySelector<HTMLElement>('.page');
        const table = doc.querySelector<HTMLTableElement>('table.log-table');
        const thead = table?.tHead;
        const body = table?.tBodies?.[0];
        if (!page || !table || !thead || !body) return null;

        // 데이터 행 + 빈 행 1 + (소계) + (합계)
        const subtotalIdx = dataRowCount + 1;
        const totalIdx = subtotalIdx + (trailing.subtotal ? 1 : 0);
        const expectedRows = dataRowCount + 1 + (trailing.subtotal ? 1 : 0) + (trailing.total ? 1 : 0);
        if (body.rows.length !== expectedRows) return null;

        const heightOf = (el: Element) => el.getBoundingClientRect().height;
        const rowHeights = Array.from({ length: dataRowCount }, (_, i) => heightOf(body.rows[i]));
        // 레이아웃이 없는 환경에서는 전부 0이 나온다 — 고정 분할로 되돌린다
        if (rowHeights.some(h => h <= 0)) return null;

        // 제목·결재란·기관/기간의 여백까지 한 번에 담기려면 표 위쪽까지의 거리를 재는 게 정확하다
        const beforeTable = table.getBoundingClientRect().top - page.getBoundingClientRect().top;
        const theadHeight = heightOf(thead);
        if (theadHeight <= 0) return null;

        return {
            overhead: beforeTable + theadHeight,
            rowHeights,
            emptyRowHeight: heightOf(body.rows[dataRowCount]),
            subtotalHeight: trailing.subtotal ? heightOf(body.rows[subtotalIdx]) : 0,
            totalHeight: trailing.total ? heightOf(body.rows[totalIdx]) : 0,
        };
    } catch {
        // 측정은 부가 기능이다 — 실패해도 내보내기 자체는 계속돼야 한다
        return null;
    } finally {
        frame?.remove();
    }
}
