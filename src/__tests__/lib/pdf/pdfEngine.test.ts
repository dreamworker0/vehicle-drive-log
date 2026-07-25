/**
 * pdfEngine.test.ts — PDF 공통 엔진 테스트
 *
 * fuelLog·hipassCharge·maintenance 3개 리포트가 공유하는 엔진이므로,
 * 여기서 깨지면 인쇄물 3종이 동시에 어긋난다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    printPdfReport,
    getTimeStr,
    buildApprovalHtml,
    buildEmptyRows,
} from '../../../lib/pdf/pdfEngine';
import type { PdfColumn } from '../../../lib/pdf/pdfEngine';
import {
    stubPrintWindow,
    stubBlockedPopup,
    expectUniformColumns,
    columnCount,
    pageTables,
    expectNoLiveInjection,
    XSS_PAYLOAD,
} from './printWindowHarness';

interface Row { date: string; name: string; amount: number }

const COLUMNS: PdfColumn[] = [
    { header: 'No.', className: 'col-no', width: '30px' },
    { header: '날짜', className: 'col-date', width: '70px' },
    { header: '이름', className: 'col-name', width: 'auto' },
    { header: '금액', className: 'col-amount', width: '80px' },
];

const renderRow = (rec: Row, idx: number, pageIdx: number, rowsPerPage: number) => `
    <tr>
        <td class="center">${idx + 1 + pageIdx * rowsPerPage}</td>
        <td class="center">${rec.date}</td>
        <td>${rec.name}</td>
        <td class="right">${rec.amount}</td>
    </tr>`;

function makeRecords(n: number): Row[] {
    // 날짜 오름차순으로 생성 — 기본 정렬(내림차순)이 실제로 동작하는지 보려면 입력이 정렬돼 있으면 안 된다
    return Array.from({ length: n }, (_, i) => ({
        date: `2026-07-${String(i + 1).padStart(2, '0')}`,
        name: `항목${i + 1}`,
        amount: (i + 1) * 100,
    }));
}

function baseConfig(records: Row[], overrides: Record<string, unknown> = {}) {
    return {
        title: '테스트 보고서',
        orgName: '테스트기관',
        records,
        columns: COLUMNS,
        renderRow,
        ...overrides,
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('printPdfReport — 실패 경로', () => {
    it('레코드가 없으면 onError를 호출하고 false를 반환하며 창을 열지 않는다', () => {
        const onError = vi.fn();
        const openSpy = vi.spyOn(window, 'open');

        expect(printPdfReport(baseConfig([], { onError }))).toBe(false);

        expect(onError).toHaveBeenCalledWith('다운로드할 데이터가 없습니다.');
        expect(openSpy).not.toHaveBeenCalled();
    });

    it('records가 undefined여도 안전하게 false를 반환한다', () => {
        const onError = vi.fn();
        expect(printPdfReport(baseConfig(undefined as unknown as Row[], { onError }))).toBe(false);
        expect(onError).toHaveBeenCalledTimes(1);
    });

    it('팝업이 차단되면 안내 메시지와 함께 false를 반환한다', () => {
        stubBlockedPopup();
        const onError = vi.fn();

        expect(printPdfReport(baseConfig(makeRecords(3), { onError }))).toBe(false);

        expect(onError).toHaveBeenCalledWith('팝업이 차단되었습니다. 팝업 허용 후 다시 시도해주세요.');
    });

    it('onError가 없어도 예외 없이 false를 반환한다', () => {
        stubBlockedPopup();
        expect(printPdfReport(baseConfig(makeRecords(1)))).toBe(false);
    });
});

describe('printPdfReport — 인쇄 창 수명주기', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('HTML을 쓰고 문서를 닫은 뒤 load 시점에 print를 호출한다', () => {
        const stub = stubPrintWindow();

        expect(printPdfReport(baseConfig(makeRecords(2)))).toBe(true);

        expect(stub.opened()).toBe(true);
        expect(stub.closed()).toBe(true);
        expect(stub.printCount()).toBe(0); // load 전에는 인쇄하지 않는다

        stub.fireLoad();
        expect(stub.printCount()).toBe(0); // 렌더 대기 300ms 이전
        vi.advanceTimersByTime(300);
        expect(stub.printCount()).toBe(1);
    });
});

describe('printPdfReport — 페이지 분할', () => {
    it('rowsPerPage 단위로 페이지를 나눈다', () => {
        const stub = stubPrintWindow();
        printPdfReport(baseConfig(makeRecords(55), { rowsPerPage: 25 }));

        expect(stub.doc().querySelectorAll('div.page')).toHaveLength(3); // 25 + 25 + 5
    });

    it('기본 rowsPerPage는 25다', () => {
        const stub = stubPrintWindow();
        printPdfReport(baseConfig(makeRecords(26)));

        expect(stub.doc().querySelectorAll('div.page')).toHaveLength(2);
    });

    it('마지막 페이지는 빈 행으로 채워 모든 페이지의 행 수가 같다', () => {
        const stub = stubPrintWindow();
        printPdfReport(baseConfig(makeRecords(7), { rowsPerPage: 5 }));

        const tables = pageTables(stub.doc());
        expect(tables).toHaveLength(2);
        // 데이터행 + 빈행 = rowsPerPage (renderTotalRow 미지정이므로 소계 행 없음)
        tables.forEach((t, i) => {
            expect(t.querySelectorAll('tbody tr'), `${i + 1}페이지 행 수`).toHaveLength(5);
        });
    });

    it('페이지 번호를 (현재 / 전체) 형식으로 표기한다', () => {
        const stub = stubPrintWindow();
        printPdfReport(baseConfig(makeRecords(7), { rowsPerPage: 5 }));

        const nums = Array.from(stub.doc().querySelectorAll('.page-num')).map(e => e.textContent?.trim());
        expect(nums).toEqual(['(1 / 2)', '(2 / 2)']);
    });

    it('레코드 수가 rowsPerPage의 배수면 빈 페이지를 만들지 않는다', () => {
        const stub = stubPrintWindow();
        printPdfReport(baseConfig(makeRecords(10), { rowsPerPage: 5 }));

        expect(stub.doc().querySelectorAll('div.page')).toHaveLength(2);
    });
});

describe('printPdfReport — 정렬', () => {
    it('기본 정렬은 date 내림차순(최신순)이다', () => {
        const stub = stubPrintWindow();
        printPdfReport(baseConfig(makeRecords(3), { rowsPerPage: 10 }));

        const dates = Array.from(stub.doc().querySelectorAll('tbody tr'))
            .map(tr => tr.children[1]?.textContent?.trim())
            .filter(d => d && d !== ' ');
        expect(dates).toEqual(['2026-07-03', '2026-07-02', '2026-07-01']);
    });

    it('sorter를 주면 그 순서를 따른다', () => {
        const stub = stubPrintWindow();
        printPdfReport(baseConfig(makeRecords(3), {
            rowsPerPage: 10,
            sorter: (a: Row, b: Row) => b.amount - a.amount,
        }));

        const names = Array.from(stub.doc().querySelectorAll('tbody tr'))
            .map(tr => tr.children[2]?.textContent?.trim())
            .filter(n => n && n !== ' ');
        expect(names).toEqual(['항목3', '항목2', '항목1']);
    });

    it('원본 배열을 변형하지 않는다', () => {
        stubPrintWindow();
        const records = makeRecords(3);
        const snapshot = records.map(r => r.date);

        printPdfReport(baseConfig(records));

        expect(records.map(r => r.date)).toEqual(snapshot);
    });
});

describe('printPdfReport — 표 구조', () => {
    it('헤더가 컬럼 정의와 1:1로 대응한다', () => {
        const stub = stubPrintWindow();
        printPdfReport(baseConfig(makeRecords(2)));

        const headers = Array.from(stub.doc().querySelectorAll('thead th'));
        expect(headers.map(h => h.textContent)).toEqual(['No.', '날짜', '이름', '금액']);
        expect(headers.map(h => h.className)).toEqual(['col-no', 'col-date', 'col-name', 'col-amount']);
    });

    it('데이터행·빈행·소계행의 열 수가 모두 헤더와 일치한다', () => {
        const stub = stubPrintWindow();
        printPdfReport(baseConfig(makeRecords(3), {
            rowsPerPage: 5,
            renderTotalRow: (rows: Row[]) =>
                `<tr class="total-row"><td colspan="3" class="center">소 계</td><td class="right">${rows.reduce((s, r) => s + r.amount, 0)}</td></tr>`,
        }));

        const table = pageTables(stub.doc())[0];
        expect(columnCount(table)).toBe(4);
        expectUniformColumns(table, '엔진 기본 표');
    });

    it('renderTotalRow는 해당 페이지의 행만 받는다', () => {
        stubPrintWindow();
        const seen: number[] = [];
        printPdfReport(baseConfig(makeRecords(7), {
            rowsPerPage: 5,
            renderTotalRow: (rows: Row[]) => { seen.push(rows.length); return '<tr><td colspan="4"></td></tr>'; },
        }));

        expect(seen).toEqual([5, 2]);
    });

    it('컬럼 정의의 width가 CSS로 반영된다', () => {
        const stub = stubPrintWindow();
        printPdfReport(baseConfig(makeRecords(1)));

        expect(stub.html()).toContain('.col-amount { width: 80px; }');
    });

    it('extraStyles가 스타일 블록에 추가된다', () => {
        const stub = stubPrintWindow();
        printPdfReport(baseConfig(makeRecords(1), { extraStyles: '.title { font-size: 20px; }' }));

        expect(stub.html()).toContain('.title { font-size: 20px; }');
    });

    it('A4 가로 방향으로 설정된다', () => {
        const stub = stubPrintWindow();
        printPdfReport(baseConfig(makeRecords(1)));

        expect(stub.html()).toContain('size: A4 landscape');
    });
});

describe('printPdfReport — 결재란', () => {
    it('결재라인이 없으면 결재 표를 넣지 않는다', () => {
        const stub = stubPrintWindow();
        printPdfReport(baseConfig(makeRecords(1)));

        expect(stub.doc().querySelectorAll('table.approval-table')).toHaveLength(0);
    });

    it('결재라인 항목마다 직위 칸과 서명 칸을 만든다', () => {
        const stub = stubPrintWindow();
        printPdfReport(baseConfig(makeRecords(1), {
            approvalLine: [{ title: '담당' }, { title: '팀장' }, { title: '원장' }],
        }));

        const approval = stub.doc().querySelector('table.approval-table')!;
        expect(Array.from(approval.querySelectorAll('.approval-title')).map(e => e.textContent))
            .toEqual(['담당', '팀장', '원장']);
        expect(approval.querySelectorAll('.approval-sign')).toHaveLength(3);
    });

    it('결재란은 모든 페이지에 반복된다', () => {
        const stub = stubPrintWindow();
        printPdfReport(baseConfig(makeRecords(7), {
            rowsPerPage: 5,
            approvalLine: [{ title: '원장' }],
        }));

        expect(stub.doc().querySelectorAll('table.approval-table')).toHaveLength(2);
    });
});

describe('printPdfReport — XSS 방어', () => {
    it('기관명에 섞인 마크업을 이스케이프한다', () => {
        const stub = stubPrintWindow();
        printPdfReport(baseConfig(makeRecords(1), { orgName: XSS_PAYLOAD }));

        expectNoLiveInjection(stub);
        expect(stub.doc().querySelector('.info-value')?.textContent).toBe(XSS_PAYLOAD);
    });

    it('결재란 직위에 섞인 마크업을 이스케이프한다', () => {
        const stub = stubPrintWindow();
        printPdfReport(baseConfig(makeRecords(1), { approvalLine: [{ title: XSS_PAYLOAD }] }));

        expectNoLiveInjection(stub);
    });
});

describe('buildApprovalHtml', () => {
    it('빈 배열이면 빈 문자열', () => {
        expect(buildApprovalHtml([])).toBe('');
    });

    it('null이어도 빈 문자열', () => {
        expect(buildApprovalHtml(null as unknown as { title: string }[])).toBe('');
    });

    it('title이 비어도 셀은 생성한다', () => {
        const html = buildApprovalHtml([{ title: '' }]);
        expect(html).toContain('approval-title');
    });
});

describe('buildEmptyRows', () => {
    it('요청한 행 수만큼 생성한다', () => {
        const doc = new DOMParser().parseFromString(`<table><tbody>${buildEmptyRows(4, 3)}</tbody></table>`, 'text/html');
        const rows = doc.querySelectorAll('tr');
        expect(rows).toHaveLength(3);
        rows.forEach(tr => expect(tr.querySelectorAll('td')).toHaveLength(4));
    });

    it('0행이면 빈 문자열 (마지막 페이지가 꽉 찬 경우)', () => {
        expect(buildEmptyRows(4, 0)).toBe('');
    });
});

describe('getTimeStr', () => {
    it('Date를 24시간제 HH:MM으로 변환한다', () => {
        expect(getTimeStr(new Date(2026, 6, 25, 14, 5))).toBe('14:05');
    });

    // 자정 표기는 ICU 버전에 따라 00:00/24:00으로 갈리므로 시각 형식만 고정한다
    it('자정도 HH:MM 형식을 유지한다', () => {
        expect(getTimeStr(new Date(2026, 6, 25, 0, 0))).toMatch(/^(00|24):00$/);
    });

    it('Firestore Timestamp(toDate)를 지원한다', () => {
        expect(getTimeStr({ toDate: () => new Date(2026, 6, 25, 9, 30) })).toBe('09:30');
    });

    it('null·undefined는 빈 문자열', () => {
        expect(getTimeStr(null)).toBe('');
        expect(getTimeStr(undefined)).toBe('');
    });

    it('toDate가 없는 객체는 빈 문자열', () => {
        expect(getTimeStr({ seconds: 1 })).toBe('');
    });
});
