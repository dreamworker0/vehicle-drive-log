/**
 * pdfExport.test.ts — 운행일지 PDF(공식 양식) 내보내기 테스트
 *
 * 기관이 대외에 제출하는 최종 산출물이라 조용히 틀리면 발견이 늦다.
 * 정렬·페이지 분할·합계·조건부 컬럼 정합성·이스케이프를 구조 단위로 고정한다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { downloadDriveLogsPdf } from '../../../lib/pdf/pdfExport';
import {
    stubPrintWindow,
    stubBlockedPopup,
    expectUniformColumns,
    columnCount,
    pageTables,
    expectNoLiveInjection,
    XSS_PAYLOAD,
} from './printWindowHarness';

interface Log {
    date?: string;
    startTime?: string;
    endTime?: string;
    departureTime?: string;
    arrivalTime?: string;
    driverName?: string;
    vehicleName?: string;
    vehicleDisplayName?: string;
    destination?: string;
    startLocation?: string;
    purpose?: string;
    startKm?: number;
    endKm?: number;
    departureKm?: number;
    arrivalKm?: number;
    passengerCount?: number;
    passengerNames?: string[];
    hipassCardNumber?: string;
    hipassBalanceBefore?: number;
    hipassBalanceAfter?: number;
    fuelSummary?: string;
    notes?: string;
}

/**
 * 실측이 불가능할 때의 되돌림 값 (pdfExport.ts의 FALLBACK_ROWS_PER_PAGE)
 *
 * 브라우저에서는 실제 행 높이를 재서 나누므로 페이지당 행 수가 내용에 따라 달라진다.
 * jsdom은 레이아웃이 없어 측정이 실패하고 이 값으로 되돌아가므로, 아래 페이지 분할
 * 테스트는 **되돌림 경로**를 고정한다. 분할 계산 자체는 pageFit.test.ts가 검증한다.
 */
const ROWS_PER_PAGE = 19;

function log(overrides: Log = {}): Log {
    return {
        date: '2026-07-01',
        startTime: '09:00',
        endTime: '10:00',
        driverName: '홍길동',
        vehicleName: '12가3456',
        destination: '시청',
        purpose: '출장',
        startKm: 1000,
        endKm: 1050,
        passengerCount: 2,
        ...overrides,
    };
}

/** 데이터가 실제로 채워진 행만 (빈 행·소계·합계 제외) */
function dataRows(doc: Document): HTMLTableRowElement[] {
    return Array.from(doc.querySelectorAll('tbody tr'))
        .filter(tr => !tr.classList.contains('total-row'))
        .filter(tr => (tr.children[0]?.textContent ?? '').trim() !== '') as HTMLTableRowElement[];
}

function cellsOf(tr: Element): string[] {
    return Array.from(tr.children).map(td => (td.textContent ?? '').trim());
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('downloadDriveLogsPdf — 실패 경로', () => {
    it('데이터가 없으면 onError를 호출하고 false를 반환하며 창을 열지 않는다', () => {
        const onError = vi.fn();
        const openSpy = vi.spyOn(window, 'open');

        expect(downloadDriveLogsPdf([], { onError })).toBe(false);

        expect(onError).toHaveBeenCalledWith('다운로드할 데이터가 없습니다.');
        expect(openSpy).not.toHaveBeenCalled();
    });

    it('logs가 undefined여도 안전하게 false를 반환한다', () => {
        const onError = vi.fn();
        expect(downloadDriveLogsPdf(undefined as unknown as Log[], { onError })).toBe(false);
        expect(onError).toHaveBeenCalledTimes(1);
    });

    it('팝업이 차단되면 안내 메시지와 함께 false를 반환한다', () => {
        stubBlockedPopup();
        const onError = vi.fn();

        expect(downloadDriveLogsPdf([log()], { onError })).toBe(false);

        expect(onError).toHaveBeenCalledWith('팝업이 차단되었습니다. 팝업 허용 후 다시 시도해주세요.');
    });
});

describe('downloadDriveLogsPdf — 정렬', () => {
    it('날짜 오름차순(오래된 순)으로 정렬한다', () => {
        const stub = stubPrintWindow();
        downloadDriveLogsPdf([
            log({ date: '2026-07-03' }),
            log({ date: '2026-07-01' }),
            log({ date: '2026-07-02' }),
        ]);

        expect(dataRows(stub.doc()).map(tr => cellsOf(tr)[1]))
            .toEqual(['2026-07-01', '2026-07-02', '2026-07-03']);
    });

    it('같은 날짜 안에서는 출발 시각 오름차순으로 정렬한다', () => {
        const stub = stubPrintWindow();
        downloadDriveLogsPdf([
            log({ date: '2026-07-01', startTime: '15:00' }),
            log({ date: '2026-07-01', startTime: '08:30' }),
            log({ date: '2026-07-01', startTime: '11:45' }),
        ]);

        expect(dataRows(stub.doc()).map(tr => cellsOf(tr)[2]))
            .toEqual(['08:30', '11:45', '15:00']);
    });

    it('departureTime만 있는 구 데이터도 같은 정렬 기준을 탄다', () => {
        const stub = stubPrintWindow();
        downloadDriveLogsPdf([
            log({ date: '2026-07-01', startTime: undefined, departureTime: '17:00' }),
            log({ date: '2026-07-01', startTime: undefined, departureTime: '07:00' }),
        ]);

        expect(dataRows(stub.doc()).map(tr => cellsOf(tr)[2])).toEqual(['07:00', '17:00']);
    });

    it('원본 배열을 변형하지 않는다', () => {
        stubPrintWindow();
        const logs = [log({ date: '2026-07-03' }), log({ date: '2026-07-01' })];

        downloadDriveLogsPdf(logs);

        expect(logs.map(l => l.date)).toEqual(['2026-07-03', '2026-07-01']);
    });
});

describe('downloadDriveLogsPdf — 페이지 분할 (실측 불가 시 되돌림)', () => {
    it('실측이 안 되면 19행마다 페이지를 나눈다', () => {
        const stub = stubPrintWindow();
        downloadDriveLogsPdf(Array.from({ length: ROWS_PER_PAGE * 2 + 1 }, () => log()));

        expect(stub.doc().querySelectorAll('div.page')).toHaveLength(3);
    });

    it('되돌림 기준 19행 정확히면 한 페이지다', () => {
        const stub = stubPrintWindow();
        downloadDriveLogsPdf(Array.from({ length: ROWS_PER_PAGE }, () => log()));

        expect(stub.doc().querySelectorAll('div.page')).toHaveLength(1);
    });

    it('마지막 페이지를 빈 행으로 채워 양식 높이를 유지한다', () => {
        const stub = stubPrintWindow();
        downloadDriveLogsPdf([log(), log()]);

        const table = pageTables(stub.doc())[0];
        // 데이터 2 + 빈행 17 + 소계 1 + 합계 1
        expect(table.querySelectorAll('tbody tr')).toHaveLength(ROWS_PER_PAGE + 2);
    });

    it('일련번호가 페이지를 넘어 이어진다', () => {
        const stub = stubPrintWindow();
        downloadDriveLogsPdf(Array.from({ length: ROWS_PER_PAGE + 2 }, (_, i) =>
            log({ date: `2026-07-${String(i + 1).padStart(2, '0')}` })));

        const nos = dataRows(stub.doc()).map(tr => cellsOf(tr)[0]);
        expect(nos[0]).toBe('1');
        expect(nos[ROWS_PER_PAGE]).toBe('20'); // 2페이지 첫 행
        expect(nos[ROWS_PER_PAGE + 1]).toBe('21');
    });

    it('페이지 번호와 기간·기관명을 머리말에 표기한다', () => {
        const stub = stubPrintWindow();
        downloadDriveLogsPdf(Array.from({ length: ROWS_PER_PAGE + 1 }, () => log()), {
            orgName: '햇살복지관',
            period: '2026-07-01 ~ 2026-07-31',
        });

        const doc = stub.doc();
        expect(Array.from(doc.querySelectorAll('.page-num')).map(e => e.textContent?.trim()))
            .toEqual(['(1 / 2)', '(2 / 2)']);
        expect(doc.querySelector('.info-value')?.textContent).toBe('햇살복지관');
        expect(stub.html()).toContain('2026-07-01 ~ 2026-07-31');
    });
});

describe('downloadDriveLogsPdf — 주행거리 계산', () => {
    it('도착 - 출발을 주행거리로 표기한다', () => {
        const stub = stubPrintWindow();
        downloadDriveLogsPdf([log({ startKm: 1000, endKm: 1123 })]);

        const cells = cellsOf(dataRows(stub.doc())[0]);
        expect(cells[8]).toBe('1,000');  // 출발
        expect(cells[9]).toBe('1,123');  // 도착
        expect(cells[10]).toBe('123');   // 주행
    });

    it('departureKm/arrivalKm(구 필드명)도 동일하게 해석한다', () => {
        const stub = stubPrintWindow();
        downloadDriveLogsPdf([log({
            startKm: undefined, endKm: undefined,
            departureKm: 500, arrivalKm: 580,
        })]);

        const cells = cellsOf(dataRows(stub.doc())[0]);
        expect(cells[8]).toBe('500');
        expect(cells[9]).toBe('580');
        expect(cells[10]).toBe('80');
    });

    it('도착이 출발보다 작으면 주행거리를 비워 음수를 인쇄하지 않는다', () => {
        const stub = stubPrintWindow();
        downloadDriveLogsPdf([log({ startKm: 1000, endKm: 900 })]);

        expect(cellsOf(dataRows(stub.doc())[0])[10]).toBe('');
    });

    it('페이지 소계는 그 페이지의 주행거리 합이다', () => {
        const stub = stubPrintWindow();
        downloadDriveLogsPdf([
            log({ date: '2026-07-01', startKm: 0, endKm: 100 }),
            log({ date: '2026-07-02', startKm: 100, endKm: 250 }),
        ]);

        const subtotal = stub.doc().querySelector('tr.total-row .total-value');
        expect(subtotal?.textContent?.trim()).toBe('250');
    });

    it('합계는 마지막 페이지에만 붙고 전체 주행거리 합이다', () => {
        const stub = stubPrintWindow();
        // 2페이지 분량: 1페이지 19건 × 10km, 2페이지 1건 × 7km
        const logs = [
            ...Array.from({ length: ROWS_PER_PAGE }, (_, i) =>
                log({ date: `2026-07-${String(i + 1).padStart(2, '0')}`, startKm: 0, endKm: 10 })),
            log({ date: '2026-07-20', startKm: 0, endKm: 7 }),
        ];
        downloadDriveLogsPdf(logs);

        const tables = pageTables(stub.doc());
        expect(tables[0].querySelectorAll('tr.total-row')).toHaveLength(1);          // 소계만
        expect(tables[1].querySelectorAll('tr.total-row')).toHaveLength(2);          // 소계 + 합계

        const lastPageTotals = Array.from(tables[1].querySelectorAll('tr.total-row .total-value'))
            .map(e => e.textContent?.trim());
        expect(lastPageTotals).toEqual(['7', '197']); // 페이지 소계 7, 전체 합계 190+7
    });

    it('주행거리가 0이면 소계·합계를 공란으로 둔다', () => {
        const stub = stubPrintWindow();
        downloadDriveLogsPdf([log({ startKm: 100, endKm: 100 })]);

        const totals = Array.from(stub.doc().querySelectorAll('tr.total-row .total-value'))
            .map(e => e.textContent?.trim());
        expect(totals).toEqual(['', '']);
    });
});

describe('downloadDriveLogsPdf — 조건부 컬럼 정합성', () => {
    // 주유·동행자 컬럼은 헤더/데이터행/빈행/소계행/합계행 다섯 곳에 각각 흩어져 있다.
    // 한 곳만 빠뜨려도 타입 검사와 린트는 통과하고 인쇄물의 표만 어긋난다.
    const cases: { label: string; opts: Record<string, boolean>; expected: number }[] = [
        { label: '기본', opts: {}, expected: 13 },
        { label: '주유 포함', opts: { includeFuel: true }, expected: 14 },
        { label: '동행자 포함', opts: { includePassengers: true }, expected: 14 },
        { label: '주유+동행자 포함', opts: { includeFuel: true, includePassengers: true }, expected: 15 },
    ];

    it.each(cases)('$label: 모든 행의 열 수가 헤더와 일치한다', ({ opts, expected }) => {
        const stub = stubPrintWindow();
        downloadDriveLogsPdf([
            log({ fuelSummary: '50,000(30L)', passengerNames: ['김직원', '이직원'] }),
            log({ date: '2026-07-02' }),
        ], opts);

        const table = pageTables(stub.doc())[0];
        expect(columnCount(table)).toBe(expected);
        expectUniformColumns(table, '운행일지 표');
    });

    it('주유 컬럼을 켜면 헤더와 값이 함께 나타난다', () => {
        const stub = stubPrintWindow();
        downloadDriveLogsPdf([log({ fuelSummary: '50,000(30L)' })], { includeFuel: true });

        const doc = stub.doc();
        expect(doc.querySelector('th.col-fuel')).not.toBeNull();
        expect(cellsOf(dataRows(doc)[0])[12]).toBe('50,000(30L)');
    });

    it('동행자 컬럼을 켜면 이름을 쉼표로 이어 표기한다', () => {
        const stub = stubPrintWindow();
        downloadDriveLogsPdf([log({ passengerNames: ['김직원', '이직원'] })], { includePassengers: true });

        const doc = stub.doc();
        expect(doc.querySelector('th.col-passengers')).not.toBeNull();
        expect(cellsOf(dataRows(doc)[0])[12]).toBe('김직원, 이직원');
    });

    // 출발지 열은 옵션이 아니라 **데이터가 정한다** — 분관을 등록한 기관의 기록에만 값이 있다.
    it('기록에 출발지가 있으면 열이 늘고 모든 행의 열 수가 맞는다', () => {
        const stub = stubPrintWindow();
        downloadDriveLogsPdf([
            log({ startLocation: '제2분관' }),
            log({ date: '2026-07-02', startLocation: '본관' }),
        ]);

        const table = pageTables(stub.doc())[0];
        expect(columnCount(table)).toBe(14);
        // 소계·합계의 colspan까지 함께 늘지 않으면 주행거리 합계 칸이 밀린다
        expectUniformColumns(table, '운행일지 표');
    });

    it('출발지가 한 건에만 있어도 열을 만들고 나머지는 공란으로 둔다', () => {
        const stub = stubPrintWindow();
        downloadDriveLogsPdf([
            log({ startLocation: '제2분관' }),
            log({ date: '2026-07-02' }),
        ]);

        const doc = stub.doc();
        expect(cellsOf(dataRows(doc)[0])[6]).toBe('제2분관');
        expect(cellsOf(dataRows(doc)[1])[6]).toBe('');
        expectUniformColumns(pageTables(doc)[0], '운행일지 표');
    });

    it('분관을 쓰지 않는 기관의 출력물은 예전 그대로다 (출발지 열 없음)', () => {
        const stub = stubPrintWindow();
        downloadDriveLogsPdf([log()]);

        const doc = stub.doc();
        const headers = Array.from(doc.querySelectorAll('thead th')).map(th => th.textContent?.trim());
        expect(headers).not.toContain('출발지');
        expect(columnCount(pageTables(doc)[0])).toBe(13);
    });

    it('컬럼을 끄면 헤더 자체가 없다', () => {
        const stub = stubPrintWindow();
        downloadDriveLogsPdf([log({ fuelSummary: 'X', passengerNames: ['Y'] })]);

        const doc = stub.doc();
        expect(doc.querySelector('th.col-fuel')).toBeNull();
        expect(doc.querySelector('th.col-passengers')).toBeNull();
    });
});

describe('downloadDriveLogsPdf — 하이패스 비고 병합', () => {
    // hipassBalanceAfter = 사용 후 잔액, 사용액 = before - after.
    // submitDriveLog(usedAmount)·VehicleStatusSection 표시와 동일한 규칙이어야 한다.
    it('사용액과 잔액을 올바른 순서로 비고에 넣는다', () => {
        const stub = stubPrintWindow();
        downloadDriveLogsPdf([log({
            notes: '',
            hipassCardNumber: '1234-5678',
            hipassBalanceBefore: 10000,
            hipassBalanceAfter: 8500,
        })], { includeHipass: true });

        const note = cellsOf(dataRows(stub.doc())[0])[12];
        expect(note).toBe('[하이패스] 1,500원 사용, 8,500원 남음');
    });

    it('기존 비고가 있으면 슬래시로 이어 붙인다', () => {
        const stub = stubPrintWindow();
        downloadDriveLogsPdf([log({
            notes: '고속도로 이용',
            hipassCardNumber: '1234-5678',
            hipassBalanceBefore: 20000,
            hipassBalanceAfter: 18000,
        })], { includeHipass: true });

        expect(cellsOf(dataRows(stub.doc())[0])[12])
            .toBe('고속도로 이용 / [하이패스] 2,000원 사용, 18,000원 남음');
    });

    it('잔액이 사용 전보다 크면(충전 후 기록 등) 사용액을 음수로 인쇄하지 않는다', () => {
        const stub = stubPrintWindow();
        downloadDriveLogsPdf([log({
            notes: '',
            hipassCardNumber: '1234-5678',
            hipassBalanceBefore: 5000,
            hipassBalanceAfter: 30000,
        })], { includeHipass: true });

        expect(cellsOf(dataRows(stub.doc())[0])[12]).toBe('[하이패스] 0원 사용, 30,000원 남음');
    });

    it('카드번호가 없으면 하이패스 정보를 붙이지 않는다', () => {
        const stub = stubPrintWindow();
        downloadDriveLogsPdf([log({ notes: '단순 비고', hipassBalanceBefore: 10000, hipassBalanceAfter: 9000 })],
            { includeHipass: true });

        expect(cellsOf(dataRows(stub.doc())[0])[12]).toBe('단순 비고');
    });

    it('includeHipass가 꺼져 있으면 비고를 건드리지 않는다', () => {
        const stub = stubPrintWindow();
        downloadDriveLogsPdf([log({
            notes: '단순 비고',
            hipassCardNumber: '1234-5678',
            hipassBalanceBefore: 10000,
            hipassBalanceAfter: 9000,
        })]);

        expect(cellsOf(dataRows(stub.doc())[0])[12]).toBe('단순 비고');
    });
});

describe('downloadDriveLogsPdf — 표시 규칙', () => {
    it('차량 표시명이 있으면 우선 사용한다', () => {
        const stub = stubPrintWindow();
        downloadDriveLogsPdf([log({ vehicleName: '12가3456', vehicleDisplayName: '스타렉스(12가3456)' })]);

        expect(cellsOf(dataRows(stub.doc())[0])[5]).toBe('스타렉스(12가3456)');
    });

    it('날짜가 없으면 timestamp를 로컬 날짜로 환산한다', () => {
        const stub = stubPrintWindow();
        downloadDriveLogsPdf([log({ date: undefined, timestamp: { toDate: () => new Date(2026, 6, 25) } } as Log)]);

        expect(cellsOf(dataRows(stub.doc())[0])[1]).toBe('2026-07-25');
    });

    it('탑승 인원이 0이면 공란으로 둔다', () => {
        const stub = stubPrintWindow();
        downloadDriveLogsPdf([log({ passengerCount: 0 })]);

        expect(cellsOf(dataRows(stub.doc())[0])[11]).toBe('');
    });

    it('결재라인을 지정하면 모든 페이지에 결재란을 넣는다', () => {
        const stub = stubPrintWindow();
        downloadDriveLogsPdf(Array.from({ length: ROWS_PER_PAGE + 1 }, () => log()), {
            approvalLine: [{ title: '담당' }, { title: '원장' }],
        });

        const doc = stub.doc();
        expect(doc.querySelectorAll('table.approval-table')).toHaveLength(2);
        expect(Array.from(doc.querySelectorAll('.approval-title')).map(e => e.textContent))
            .toEqual(['담당', '원장', '담당', '원장']);
    });
});

describe('downloadDriveLogsPdf — XSS 방어', () => {
    it('기관명·목적지·비고에 섞인 마크업을 이스케이프한다', () => {
        const stub = stubPrintWindow();
        downloadDriveLogsPdf([log({
            destination: XSS_PAYLOAD,
            notes: XSS_PAYLOAD,
            driverName: XSS_PAYLOAD,
        })], { orgName: XSS_PAYLOAD, period: XSS_PAYLOAD });

        expectNoLiveInjection(stub);
        const cells = cellsOf(dataRows(stub.doc())[0]);
        expect(cells[6]).toBe(XSS_PAYLOAD); // 목적지가 텍스트로만 남는다
    });

    it('동행자 이름에 섞인 마크업을 이스케이프한다', () => {
        const stub = stubPrintWindow();
        downloadDriveLogsPdf([log({ passengerNames: [XSS_PAYLOAD] })], { includePassengers: true });

        expectNoLiveInjection(stub);
    });
});
