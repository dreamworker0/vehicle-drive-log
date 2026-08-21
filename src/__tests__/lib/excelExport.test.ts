/**
 * excelExport.js 테스트
 */
import { describe, it, expect, vi } from 'vitest';

// xlsx를 모킹 — 실제 xlsx 라이브러리 로딩 방지
vi.mock('xlsx', () => ({
    utils: {
        json_to_sheet: vi.fn().mockReturnValue({}),
        book_new: vi.fn().mockReturnValue({}),
        book_append_sheet: vi.fn(),
    },
    writeFile: vi.fn(),
}));

import { downloadDriveLogsExcel } from '../../lib/excelExport';
import * as XLSX from 'xlsx';
import { Timestamp } from 'firebase/firestore';

/** 마지막 json_to_sheet 호출에 넘어간 행 배열 (열 구성을 그대로 볼 수 있다) */
function lastSheetRows(): Record<string, string>[] {
    const calls = (XLSX.utils.json_to_sheet as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    return calls[calls.length - 1][0] as Record<string, string>[];
}

describe('downloadDriveLogsExcel', () => {
    it('빈 배열이면 onError를 호출하고 false를 반환해야 한다', async () => {
        const onError = vi.fn();
        const result = await downloadDriveLogsExcel([], '테스트', { onError });
        expect(onError).toHaveBeenCalledWith('다운로드할 데이터가 없습니다.');
        expect(result).toBe(false);
    });

    it('null이면 onError를 호출하고 false를 반환해야 한다', async () => {
        const onError = vi.fn();
        const result = await downloadDriveLogsExcel(null as unknown as Parameters<typeof downloadDriveLogsExcel>[0], '테스트', { onError });
        expect(onError).toHaveBeenCalled();
        expect(result).toBe(false);
    });

    it('정상 데이터면 XLSX.writeFile을 호출해야 한다', async () => {
        const logs = [
            {
                date: '2026-03-05',
                driverName: '홍길동',
                vehicleName: '소나타',
                startTime: '09:00',
                endTime: '10:00',
                destination: '시청',
                purpose: '관공서',
                startKm: 1000,
                endKm: 1050,
                passengerCount: 2,
                notes: '',
            },
        ];

        await downloadDriveLogsExcel(logs, '운행일지_테스트');

        expect(XLSX.utils.json_to_sheet).toHaveBeenCalled();
        expect(XLSX.utils.book_new).toHaveBeenCalled();
        expect(XLSX.utils.book_append_sheet).toHaveBeenCalled();
        expect(XLSX.writeFile).toHaveBeenCalledWith(
            expect.anything(),
            '운행일지_테스트.xlsx'
        );
    });

    it('기본 파일명은 "운행일지"여야 한다', async () => {
        const logs = [{ date: '2026-03-05', driverName: '테스트' }];
        await downloadDriveLogsExcel(logs);
        expect(XLSX.writeFile).toHaveBeenCalledWith(
            expect.anything(),
            '운행일지.xlsx'
        );
    });

    // 출발지 열은 옵션이 아니라 데이터가 정한다 — 분관을 등록한 기관의 기록에만 값이 있다.
    it('출발지가 있는 기록이면 출발지 열을 차량과 목적지 사이에 넣는다', async () => {
        await downloadDriveLogsExcel([
            { date: '2026-03-05', vehicleName: '소나타', startLocation: '제2분관', destination: '시청' },
            { date: '2026-03-06', vehicleName: '스타렉스', destination: '주민센터' },
        ]);

        const rows = lastSheetRows();
        expect(Object.keys(rows[0])).toEqual([
            '날짜', '출발시각', '도착시각', '운전자', '차량', '출발지', '목적지', '사용목적',
            '출발Km', '도착Km', '주행거리(km)', '탑승인원', '비고',
        ]);
        expect(rows[0]['출발지']).toBe('제2분관');
        // 값이 없는 행에도 키는 있어야 열이 밀리지 않는다
        expect(rows[1]['출발지']).toBe('');
    });

    it('분관을 쓰지 않는 기관의 파일에는 출발지 열이 없다', async () => {
        await downloadDriveLogsExcel([
            { date: '2026-03-05', vehicleName: '소나타', destination: '시청' },
        ]);

        const rows = lastSheetRows();
        expect(Object.keys(rows[0])).not.toContain('출발지');
    });

    it('Firestore timestamp 형식 로그도 처리해야 한다', async () => {
        const logs = [
            {
                timestamp: Timestamp.fromDate(new Date('2026-03-05T09:00:00')),
                driverName: '테스트',
                vehicleDisplayName: '스타렉스',
                departureTime: '09:00',
                arrivalTime: '10:00',
                destination: '본사',
                departureKm: 5000,
                arrivalKm: 5080,
                energyCost: 30000,
            },
        ];

        await downloadDriveLogsExcel(logs);
        expect(XLSX.utils.json_to_sheet).toHaveBeenCalled();
    });
});
