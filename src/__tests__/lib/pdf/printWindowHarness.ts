/**
 * PDF 내보내기 테스트 공용 하네스
 *
 * PDF 모듈은 전부 `window.open()` → `document.write(html)` → `print()` 경로로 동작한다.
 * jsdom의 window.open은 실제 창을 열지 못하므로, 쓰여진 HTML을 가로채 DOM으로 파싱해
 * "출력물의 구조"를 직접 단언할 수 있게 한다. 문자열 부분일치가 아니라 표 구조를 보므로
 * 컬럼 추가/조건부 컬럼 누락 같은 조용한 레이아웃 회귀를 잡는다.
 */
import { vi, expect } from 'vitest';

export interface PrintWindowStub {
    /** document.write로 누적된 전체 HTML */
    html: () => string;
    /** 누적 HTML을 파싱한 Document */
    doc: () => Document;
    /** window.open 호출 여부 */
    opened: () => boolean;
    /** printWindow.print() 호출 횟수 */
    printCount: () => number;
    /** document.close() 호출 여부 */
    closed: () => boolean;
    /** 브라우저 load 이벤트를 흉내낸다 (onload → setTimeout → print) */
    fireLoad: () => void;
}

/**
 * window.open을 가짜 인쇄 창으로 교체한다.
 * afterEach의 vi.restoreAllMocks()로 원복된다.
 */
export function stubPrintWindow(): PrintWindowStub {
    let html = '';
    let printCount = 0;
    let closed = false;
    let opened = false;

    const fake = {
        document: {
            write: (chunk: string) => { html += chunk; },
            close: () => { closed = true; },
        },
        print: () => { printCount += 1; },
        onload: null as null | (() => void),
    };

    vi.spyOn(window, 'open').mockImplementation(() => {
        opened = true;
        return fake as unknown as Window;
    });

    return {
        html: () => html,
        doc: () => new DOMParser().parseFromString(html, 'text/html'),
        opened: () => opened,
        printCount: () => printCount,
        closed: () => closed,
        fireLoad: () => { fake.onload?.(); },
    };
}

/** 팝업 차단 상황 — window.open이 null을 반환한다 */
export function stubBlockedPopup(): void {
    vi.spyOn(window, 'open').mockReturnValue(null);
}

/**
 * 표의 전체 열 수 — thead 첫 행의 colspan 합.
 * (rowspan=2 셀은 1열, colspan=N 그룹 헤더는 N열. 둘째 헤더 행은 그룹의 하위 열이라 중복 계산하지 않는다)
 */
export function columnCount(table: HTMLTableElement): number {
    const firstRow = table.querySelector('thead tr');
    if (!firstRow) return 0;
    return Array.from(firstRow.querySelectorAll('th'))
        .reduce((sum, th) => sum + Number(th.getAttribute('colspan') ?? 1), 0);
}

/**
 * 표의 모든 본문 행이 헤더와 같은 열 수를 갖는지 검증한다.
 *
 * 조건부 컬럼(주유·동행자 등)은 헤더·데이터행·빈행·소계행 네 곳에 각각 흩어져 있어,
 * 한 곳만 빠뜨려도 타입 검사·린트는 통과하고 인쇄물만 어긋난다. 이 불변식이 그 회귀를 막는다.
 */
export function expectUniformColumns(table: HTMLTableElement, label = '표'): void {
    const expected = columnCount(table);
    const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
    expect(bodyRows.length, `${label}: 본문 행이 없음`).toBeGreaterThan(0);

    bodyRows.forEach((tr, i) => {
        const cells = Array.from(tr.querySelectorAll('td'))
            .reduce((s, td) => s + Number(td.getAttribute('colspan') ?? 1), 0);
        expect(cells, `${label}: ${i + 1}번째 본문 행의 열 수가 헤더(${expected})와 불일치`).toBe(expected);
    });
}

/** 문서 내 데이터 표 목록 (페이지당 1개) */
export function pageTables(doc: Document): HTMLTableElement[] {
    return Array.from(doc.querySelectorAll('table.log-table'));
}

/**
 * 주입된 마크업이 이스케이프되어 실행 가능한 노드로 남지 않았는지 확인한다.
 * PDF 경로는 사용자 입력(기관명·목적지·비고)을 document.write로 새 창에 보간하므로
 * escapeHtml 누락이 곧 XSS다.
 */
export function expectNoLiveInjection(stub: PrintWindowStub): void {
    const doc = stub.doc();
    expect(doc.querySelectorAll('script').length, '주입된 <script>가 살아있음').toBe(0);
    expect(doc.querySelectorAll('img').length, '주입된 <img>가 살아있음').toBe(0);
}

/** XSS 시도 문자열 — 이스케이프되면 텍스트로만 남는다 */
export const XSS_PAYLOAD = '<script>alert(1)</script><img src=x onerror=alert(2)>';
