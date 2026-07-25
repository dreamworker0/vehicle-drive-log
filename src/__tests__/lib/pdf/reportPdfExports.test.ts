/**
 * reportPdfExports.test.ts — 주유·하이패스 충전·정비 기록 PDF 테스트
 *
 * 세 모듈 모두 pdfEngine 위에 컬럼 정의 + 행 변환만 얹은 구조라,
 * 여기서는 "컬럼 정의와 렌더 결과가 어긋나지 않는가"와 각 모듈 고유의 계산·표기 규칙을 고정한다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { downloadFuelLogPdf } from '../../../lib/pdf/fuelLogPdfExport';
import { downloadHipassChargePdf } from '../../../lib/pdf/hipassChargePdfExport';
import { downloadMaintenancePdf } from '../../../lib/pdf/maintenancePdfExport';
import {
    stubPrintWindow,
    stubBlockedPopup,
    expectUniformColumns,
    columnCount,
    pageTables,
    expectNoLiveInjection,
    XSS_PAYLOAD,
} from './printWindowHarness';

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

// ── 세 리포트 공통 계약 ──────────────────────────────────────────

const REPORTS = [
    {
        name: '주유 기록',
        columns: 9,
        title: '주유 / 충전 기록',
        run: (records: unknown[], opts: Record<string, unknown> = {}) =>
            downloadFuelLogPdf(records as Parameters<typeof downloadFuelLogPdf>[0], opts),
        sample: { date: '2026-07-01', vehicleName: '12가3456', driverName: '홍길동', fuelAmount: 30, fuelCost: 50000 },
    },
    {
        name: '하이패스 충전',
        columns: 9,
        title: '하 이 패 스 충 전 기 록',
        run: (records: unknown[], opts: Record<string, unknown> = {}) =>
            downloadHipassChargePdf(records as Parameters<typeof downloadHipassChargePdf>[0], opts),
        sample: { date: '2026-07-01', vehicleName: '12가3456', chargerName: '홍길동', chargeAmount: 30000 },
    },
    {
        name: '정비 기록',
        columns: 11,
        title: '차량 정비 기록',
        run: (records: unknown[], opts: Record<string, unknown> = {}) =>
            downloadMaintenancePdf(records as Parameters<typeof downloadMaintenancePdf>[0], opts),
        sample: { date: '2026-07-01', vehicleName: '12가3456', type: 'oil', cost: 80000 },
    },
] as const;

describe.each(REPORTS)('$name PDF — 공통 계약', ({ columns, title, run, sample }) => {
    it('데이터가 없으면 onError와 함께 false를 반환한다', () => {
        const onError = vi.fn();
        const openSpy = vi.spyOn(window, 'open');

        expect(run([], { onError })).toBe(false);

        expect(onError).toHaveBeenCalledWith('다운로드할 데이터가 없습니다.');
        expect(openSpy).not.toHaveBeenCalled();
    });

    it('팝업이 차단되면 false를 반환한다', () => {
        stubBlockedPopup();
        const onError = vi.fn();

        expect(run([sample], { onError })).toBe(false);

        expect(onError).toHaveBeenCalledWith('팝업이 차단되었습니다. 팝업 허용 후 다시 시도해주세요.');
    });

    it('정상 출력 시 true를 반환하고 제목·기관명을 표기한다', () => {
        const stub = stubPrintWindow();

        expect(run([sample], { orgName: '햇살복지관' })).toBe(true);

        const doc = stub.doc();
        expect(doc.querySelector('.title')?.textContent).toBe(title);
        expect(doc.querySelector('.info-value')?.textContent).toBe('햇살복지관');
    });

    it('컬럼 정의와 모든 행(데이터·빈행·소계)의 열 수가 일치한다', () => {
        const stub = stubPrintWindow();
        run([sample, { ...sample, date: '2026-07-02' }]);

        const table = pageTables(stub.doc())[0];
        expect(columnCount(table)).toBe(columns);
        expectUniformColumns(table, `${title} 표`);
    });

    it('사용자 입력에 섞인 마크업을 이스케이프한다', () => {
        const stub = stubPrintWindow();
        run([{ ...sample, vehicleName: XSS_PAYLOAD, notes: XSS_PAYLOAD, description: XSS_PAYLOAD, shop: XSS_PAYLOAD }],
            { orgName: XSS_PAYLOAD });

        expectNoLiveInjection(stub);
    });

    it('결재라인을 전달하면 결재란을 만든다', () => {
        const stub = stubPrintWindow();
        run([sample], { approvalLine: [{ title: '원장' }] });

        expect(stub.doc().querySelector('.approval-title')?.textContent).toBe('원장');
    });
});

// ── 주유 기록 고유 규칙 ──────────────────────────────────────────

describe('downloadFuelLogPdf', () => {
    const fuel = (o: Record<string, unknown> = {}) => ({
        date: '2026-07-01',
        vehicleName: '12가3456',
        driverName: '홍길동',
        meterReading: 12345,
        fuelAmount: 30,
        fuelCost: 50000,
        ...o,
    });

    it('휘발유/경유는 L 단위로 표기한다', () => {
        const stub = stubPrintWindow();
        downloadFuelLogPdf([fuel({ fuelType: 'gasoline', fuelAmount: 30 })]);

        expect(cellsOf(dataRows(stub.doc())[0])[6]).toBe('30 L');
    });

    it('전기차는 kWh 단위로 표기한다', () => {
        const stub = stubPrintWindow();
        downloadFuelLogPdf([fuel({ fuelType: 'electric', fuelAmount: 42 })]);

        expect(cellsOf(dataRows(stub.doc())[0])[6]).toBe('42 kWh');
    });

    it('수소차는 kg 단위로 표기한다', () => {
        const stub = stubPrintWindow();
        downloadFuelLogPdf([fuel({ fuelType: 'hydrogen', fuelAmount: 5 })]);

        expect(cellsOf(dataRows(stub.doc())[0])[6]).toBe('5 kg');
    });

    it('연료 유형이 없으면 L로 처리한다', () => {
        const stub = stubPrintWindow();
        downloadFuelLogPdf([fuel({ fuelType: undefined, fuelAmount: 20 })]);

        expect(cellsOf(dataRows(stub.doc())[0])[6]).toBe('20 L');
    });

    it('주유량이 0이면 단위 없이 공란으로 둔다', () => {
        const stub = stubPrintWindow();
        downloadFuelLogPdf([fuel({ fuelAmount: 0 })]);

        expect(cellsOf(dataRows(stub.doc())[0])[6]).toBe('');
    });

    it('소계는 주유량 합과 금액 합이다', () => {
        const stub = stubPrintWindow();
        downloadFuelLogPdf([
            fuel({ date: '2026-07-01', fuelAmount: 30, fuelCost: 50000 }),
            fuel({ date: '2026-07-02', fuelAmount: 25, fuelCost: 41000 }),
        ]);

        const totals = Array.from(stub.doc().querySelectorAll('tr.total-row .total-value'))
            .map(e => e.textContent?.trim());
        expect(totals).toEqual(['55', '91,000']);
    });

    it('주유미터를 천단위로 표기한다', () => {
        const stub = stubPrintWindow();
        downloadFuelLogPdf([fuel({ meterReading: 123456 })]);

        expect(cellsOf(dataRows(stub.doc())[0])[5]).toBe('123,456');
    });

    it('createdAt(Firestore Timestamp)에서 시각을 뽑는다', () => {
        const stub = stubPrintWindow();
        downloadFuelLogPdf([fuel({ createdAt: { toDate: () => new Date(2026, 6, 1, 14, 30) } })]);

        expect(cellsOf(dataRows(stub.doc())[0])[2]).toBe('14:30');
    });

    it('25건마다 페이지를 나눈다', () => {
        const stub = stubPrintWindow();
        downloadFuelLogPdf(Array.from({ length: 26 }, (_, i) =>
            fuel({ date: `2026-07-${String(i + 1).padStart(2, '0')}` })));

        expect(stub.doc().querySelectorAll('div.page')).toHaveLength(2);
    });
});

// ── 하이패스 충전 고유 규칙 ──────────────────────────────────────

describe('downloadHipassChargePdf', () => {
    const charge = (o: Record<string, unknown> = {}) => ({
        date: '2026-07-01',
        vehicleName: '12가3456',
        chargerName: '홍길동',
        cardNumber: '1234-5678',
        chargeAmount: 30000,
        balanceBefore: 5000,
        balanceAfter: 35000,
        ...o,
    });

    it('충전 전/후 잔액을 천단위로 표기한다', () => {
        const stub = stubPrintWindow();
        downloadHipassChargePdf([charge()]);

        const cells = cellsOf(dataRows(stub.doc())[0]);
        expect(cells[6]).toBe('30,000'); // 충전금액
        expect(cells[7]).toBe('5,000');  // 충전 전
        expect(cells[8]).toBe('35,000'); // 충전 후
    });

    it('잔액이 0이면 공란이 아니라 0으로 표기한다', () => {
        const stub = stubPrintWindow();
        downloadHipassChargePdf([charge({ balanceBefore: 0 })]);

        expect(cellsOf(dataRows(stub.doc())[0])[7]).toBe('0');
    });

    it('소계는 충전금액 합이다', () => {
        const stub = stubPrintWindow();
        downloadHipassChargePdf([
            charge({ date: '2026-07-01', chargeAmount: 30000 }),
            charge({ date: '2026-07-02', chargeAmount: 20000 }),
        ]);

        expect(stub.doc().querySelector('tr.total-row .total-value')?.textContent?.trim()).toBe('50,000');
    });

    it('긴 제목이 넘치지 않도록 title 폰트를 줄인다', () => {
        const stub = stubPrintWindow();
        downloadHipassChargePdf([charge()]);

        expect(stub.html()).toContain('.title { font-size: 20px; }');
    });
});

// ── 정비 기록 고유 규칙 ──────────────────────────────────────────

describe('downloadMaintenancePdf', () => {
    const maint = (o: Record<string, unknown> = {}) => ({
        date: '2026-07-01',
        vehicleName: '12가3456',
        type: 'oil',
        cost: 80000,
        shop: '동네카센터',
        km: 45000,
        ...o,
    });

    it('typeLabels로 정비 유형 코드를 한글 라벨로 바꾼다', () => {
        const stub = stubPrintWindow();
        downloadMaintenancePdf([maint({ type: 'oil' })], { typeLabels: { oil: '엔진오일' } });

        expect(cellsOf(dataRows(stub.doc())[0])[3]).toBe('엔진오일');
    });

    it('매핑에 없는 유형은 코드를 그대로 표기한다', () => {
        const stub = stubPrintWindow();
        downloadMaintenancePdf([maint({ type: 'unknown-type' })], { typeLabels: { oil: '엔진오일' } });

        expect(cellsOf(dataRows(stub.doc())[0])[3]).toBe('unknown-type');
    });

    it('typeLabels를 주지 않아도 코드로 출력한다', () => {
        const stub = stubPrintWindow();
        downloadMaintenancePdf([maint({ type: 'brake' })]);

        expect(cellsOf(dataRows(stub.doc())[0])[3]).toBe('brake');
    });

    it('차량 차단 건에는 표시를 넣고 아닌 건은 비운다', () => {
        const stub = stubPrintWindow();
        downloadMaintenancePdf([
            maint({ date: '2026-07-02', blockVehicle: true }),
            maint({ date: '2026-07-01', blockVehicle: false }),
        ]);

        const rows = dataRows(stub.doc());
        expect(cellsOf(rows[0])[10]).toBe('●'); // 최신순 정렬이므로 07-02가 먼저
        expect(cellsOf(rows[1])[10]).toBe('');
    });

    it('다음 정비일이 없으면 공란으로 둔다', () => {
        const stub = stubPrintWindow();
        downloadMaintenancePdf([maint({ nextDueDate: undefined })]);

        expect(cellsOf(dataRows(stub.doc())[0])[8]).toBe('');
    });

    it('다음 정비일이 있으면 날짜로 표기한다', () => {
        const stub = stubPrintWindow();
        downloadMaintenancePdf([maint({ nextDueDate: '2026-12-31' })]);

        expect(cellsOf(dataRows(stub.doc())[0])[8]).toBe('2026-12-31');
    });

    it('소계는 비용 합이다', () => {
        const stub = stubPrintWindow();
        downloadMaintenancePdf([
            maint({ date: '2026-07-01', cost: 80000 }),
            maint({ date: '2026-07-02', cost: 120000 }),
        ]);

        expect(stub.doc().querySelector('tr.total-row .total-value')?.textContent?.trim()).toBe('200,000');
    });

    it('비용이 없으면 소계를 공란으로 둔다', () => {
        const stub = stubPrintWindow();
        downloadMaintenancePdf([maint({ cost: 0 })]);

        expect(stub.doc().querySelector('tr.total-row .total-value')?.textContent?.trim()).toBe('');
    });

    it('22건마다 페이지를 나눈다', () => {
        const stub = stubPrintWindow();
        downloadMaintenancePdf(Array.from({ length: 23 }, (_, i) =>
            maint({ date: `2026-07-${String(i + 1).padStart(2, '0')}` })));

        expect(stub.doc().querySelectorAll('div.page')).toHaveLength(2);
    });
});
