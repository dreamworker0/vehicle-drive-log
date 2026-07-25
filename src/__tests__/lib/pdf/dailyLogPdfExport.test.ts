/**
 * dailyLogPdfExport.test.ts — 일별 차량운행일지 PDF(A4 세로 종이 양식) 테스트
 *
 * 12행 고정 양식이라 행 수·요약표 구조가 어긋나면 종이 양식과 맞지 않는다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { downloadDailyLogPdf } from '../../../lib/pdf/dailyLogPdfExport';
import {
    stubPrintWindow,
    stubBlockedPopup,
    expectUniformColumns,
    expectNoLiveInjection,
    XSS_PAYLOAD,
} from './printWindowHarness';

const MAX_ROWS = 12;

interface Drive {
    driverName?: string;
    passengers?: number;
    purpose?: string;
    destination?: string;
    startTime?: string;
    endTime?: string;
    startKm?: number;
    endKm?: number;
}

function drive(overrides: Drive = {}): Drive {
    return {
        driverName: '홍길동',
        passengers: 2,
        purpose: '출장',
        destination: '시청',
        startTime: '09:00',
        endTime: '10:30',
        startKm: 1000,
        endKm: 1042,
        ...overrides,
    };
}

function dataRows(doc: Document): HTMLTableRowElement[] {
    return Array.from(doc.querySelectorAll('table.log-table tbody tr'))
        .filter(tr => (tr.children[0]?.textContent ?? '').trim() !== '') as HTMLTableRowElement[];
}

function cellsOf(tr: Element): string[] {
    return Array.from(tr.children).map(td => (td.textContent ?? '').trim());
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('downloadDailyLogPdf — 실패 경로', () => {
    it('운행 기록이 없으면 전용 안내와 함께 false를 반환한다', () => {
        const onError = vi.fn();
        const openSpy = vi.spyOn(window, 'open');

        expect(downloadDailyLogPdf([], [], { onError })).toBe(false);

        expect(onError).toHaveBeenCalledWith('운행 기록이 없습니다.');
        expect(openSpy).not.toHaveBeenCalled();
    });

    it('driveLogs가 undefined여도 안전하게 false를 반환한다', () => {
        const onError = vi.fn();
        expect(downloadDailyLogPdf(undefined as unknown as Drive[], [], { onError })).toBe(false);
        expect(onError).toHaveBeenCalledTimes(1);
    });

    it('팝업이 차단되면 안내 메시지와 함께 false를 반환한다', () => {
        stubBlockedPopup();
        const onError = vi.fn();

        expect(downloadDailyLogPdf([drive()], [], { onError })).toBe(false);

        expect(onError).toHaveBeenCalledWith('팝업이 차단되었습니다. 팝업 허용 후 다시 시도해주세요.');
    });
});

describe('downloadDailyLogPdf — 양식 구조', () => {
    it('A4 세로 한 장으로 출력한다', () => {
        const stub = stubPrintWindow();
        downloadDailyLogPdf([drive()], []);

        expect(stub.html()).toContain('size: A4 portrait');
        expect(stub.doc().querySelectorAll('div.page')).toHaveLength(1);
    });

    it('기록이 12행보다 적으면 빈 행으로 채운다', () => {
        const stub = stubPrintWindow();
        downloadDailyLogPdf([drive(), drive()], []);

        expect(stub.doc().querySelectorAll('table.log-table tbody tr')).toHaveLength(MAX_ROWS);
    });

    it('기록이 12행을 넘으면 잘라내지 않고 전부 출력한다', () => {
        const stub = stubPrintWindow();
        downloadDailyLogPdf(Array.from({ length: 15 }, () => drive()), []);

        expect(stub.doc().querySelectorAll('table.log-table tbody tr')).toHaveLength(15);
    });

    it('모든 행의 열 수가 헤더(7열)와 일치한다', () => {
        const stub = stubPrintWindow();
        downloadDailyLogPdf([drive()], []);

        const table = stub.doc().querySelector('table.log-table') as HTMLTableElement;
        expectUniformColumns(table, '일별일지 표');
        expect(table.querySelectorAll('thead th')).toHaveLength(7);
    });

    it('입력 순서를 그대로 유지한다 (재정렬하지 않음)', () => {
        const stub = stubPrintWindow();
        downloadDailyLogPdf([
            drive({ driverName: '가' }),
            drive({ driverName: '나' }),
            drive({ driverName: '다' }),
        ], []);

        expect(dataRows(stub.doc()).map(tr => cellsOf(tr)[0])).toEqual(['가', '나', '다']);
    });
});

describe('downloadDailyLogPdf — 운행 행 표기', () => {
    it('출발-도착 시각을 하이픈으로 잇는다', () => {
        const stub = stubPrintWindow();
        downloadDailyLogPdf([drive({ startTime: '09:00', endTime: '10:30' })], []);

        expect(cellsOf(dataRows(stub.doc())[0])[4]).toBe('09:00-10:30');
    });

    it('한쪽 시각만 있으면 그것만 표기한다', () => {
        const stub = stubPrintWindow();
        downloadDailyLogPdf([drive({ startTime: '09:00', endTime: undefined })], []);

        expect(cellsOf(dataRows(stub.doc())[0])[4]).toBe('09:00');
    });

    it('시각이 둘 다 없으면 공란이다', () => {
        const stub = stubPrintWindow();
        downloadDailyLogPdf([drive({ startTime: undefined, endTime: undefined })], []);

        expect(cellsOf(dataRows(stub.doc())[0])[4]).toBe('');
    });

    it('운행거리와 누계(도착 km)를 천단위로 표기한다', () => {
        const stub = stubPrintWindow();
        downloadDailyLogPdf([drive({ startKm: 10000, endKm: 12345 })], []);

        const cells = cellsOf(dataRows(stub.doc())[0]);
        expect(cells[5]).toBe('2,345');   // 운행거리
        expect(cells[6]).toBe('12,345');  // 누계
    });

    it('도착이 출발보다 작으면 운행거리를 공란으로 둔다', () => {
        const stub = stubPrintWindow();
        downloadDailyLogPdf([drive({ startKm: 1000, endKm: 900 })], []);

        expect(cellsOf(dataRows(stub.doc())[0])[5]).toBe('');
    });

    it('탑승 인원이 0이면 공란으로 둔다', () => {
        const stub = stubPrintWindow();
        downloadDailyLogPdf([drive({ passengers: 0 })], []);

        expect(cellsOf(dataRows(stub.doc())[0])[1]).toBe('');
    });
});

describe('downloadDailyLogPdf — 운행상황 요약', () => {
    it('금일 거리·전일 누계·금일 누계를 표기한다', () => {
        const stub = stubPrintWindow();
        downloadDailyLogPdf([drive()], [], {
            todayDistance: 142,
            previousEndKm: 10000,
            todayEndKm: 10142,
        });

        const values = Array.from(stub.doc().querySelectorAll('.summary-table .value-cell'))
            .map(e => e.textContent?.trim());
        expect(values).toEqual(['142 km', '10,000 km', '10,142 km']);
    });

    it('누계를 모르면 하이픈으로 표기한다', () => {
        const stub = stubPrintWindow();
        downloadDailyLogPdf([drive()], [], { todayDistance: 0, previousEndKm: null, todayEndKm: null });

        const values = Array.from(stub.doc().querySelectorAll('.summary-table .value-cell'))
            .map(e => e.textContent?.trim());
        expect(values).toEqual(['0 km', '- km', '- km']);
    });

    it('누계가 0이면 하이픈이 아니라 0으로 표기한다', () => {
        const stub = stubPrintWindow();
        downloadDailyLogPdf([drive()], [], { previousEndKm: 0, todayEndKm: 0 });

        const values = Array.from(stub.doc().querySelectorAll('.summary-table .value-cell'))
            .map(e => e.textContent?.trim());
        expect(values.slice(1)).toEqual(['0 km', '0 km']);
    });
});

describe('downloadDailyLogPdf — 주유 상황', () => {
    it('주유 기록이 없으면 주유 섹션을 만들지 않는다', () => {
        const stub = stubPrintWindow();
        downloadDailyLogPdf([drive()], []);

        expect(stub.doc().querySelector('.fuel-header')).toBeNull();
        expect(stub.doc().querySelectorAll('.fuel-value')).toHaveLength(0);
    });

    it('주유 기록이 있으면 주유원·미터·주유량·금액을 표기한다', () => {
        const stub = stubPrintWindow();
        downloadDailyLogPdf([drive()], [{
            driverName: '김주유',
            meterReading: 12345,
            fuelAmount: 40,
            fuelCost: 68000,
        }]);

        const doc = stub.doc();
        expect(doc.querySelector('.fuel-header')).not.toBeNull();
        expect(Array.from(doc.querySelectorAll('.fuel-value')).map(e => e.textContent?.trim()))
            .toEqual(['김주유', '12,345', '40', '68,000']);
    });

    it('주유 기록이 여러 건이면 첫 건만 요약에 넣는다', () => {
        const stub = stubPrintWindow();
        downloadDailyLogPdf([drive()], [
            { driverName: '첫번째', fuelCost: 1000 },
            { driverName: '두번째', fuelCost: 2000 },
        ]);

        expect(stub.doc().querySelector('.fuel-value')?.textContent?.trim()).toBe('첫번째');
        expect(stub.html()).not.toContain('두번째');
    });
});

describe('downloadDailyLogPdf — 머리말', () => {
    it('날짜를 한국어 형식으로 표기하고 앞자리 0을 뗀다', () => {
        const stub = stubPrintWindow();
        downloadDailyLogPdf([drive()], [], { date: '2026-07-05', vehicleName: '12가3456', orgName: '햇살복지관' });

        const text = stub.doc().querySelector('.date-text')?.textContent ?? '';
        expect(text).toContain('2026년 7월 5일');
        expect(text).toContain('12가3456');
        expect(stub.doc().querySelector('.org-text')?.textContent).toContain('햇살복지관');
    });

    it('날짜 형식이 예상과 다르면 원문을 그대로 표기한다', () => {
        const stub = stubPrintWindow();
        downloadDailyLogPdf([drive()], [], { date: '2026/07/05' });

        expect(stub.doc().querySelector('.date-text')?.textContent).toContain('2026/07/05');
    });

    it('날짜가 없어도 예외 없이 출력한다', () => {
        const stub = stubPrintWindow();
        downloadDailyLogPdf([drive()], [], {});

        expect(stub.doc().querySelector('.date-text')).not.toBeNull();
    });

    it('결재라인을 지정하면 결재란을 만든다', () => {
        const stub = stubPrintWindow();
        downloadDailyLogPdf([drive()], [], { approvalLine: [{ title: '담당' }, { title: '원장' }] });

        expect(Array.from(stub.doc().querySelectorAll('.approval-title')).map(e => e.textContent))
            .toEqual(['담당', '원장']);
    });

    it('결재라인이 없으면 결재란을 만들지 않는다', () => {
        const stub = stubPrintWindow();
        downloadDailyLogPdf([drive()], []);

        expect(stub.doc().querySelector('.approval-table')).toBeNull();
    });
});

describe('downloadDailyLogPdf — XSS 방어', () => {
    it('기관명·차량명·목적지·주유원에 섞인 마크업을 이스케이프한다', () => {
        const stub = stubPrintWindow();
        downloadDailyLogPdf(
            [drive({ destination: XSS_PAYLOAD, driverName: XSS_PAYLOAD, purpose: XSS_PAYLOAD })],
            [{ driverName: XSS_PAYLOAD }],
            { orgName: XSS_PAYLOAD, vehicleName: XSS_PAYLOAD, date: XSS_PAYLOAD },
        );

        expectNoLiveInjection(stub);
        expect(cellsOf(dataRows(stub.doc())[0])[3]).toBe(XSS_PAYLOAD);
    });
});
