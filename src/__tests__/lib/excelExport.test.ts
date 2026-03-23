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

    it('Firestore timestamp 형식 로그도 처리해야 한다', async () => {
        const logs = [
            {
                timestamp: { toDate: () => new Date('2026-03-05T09:00:00') },
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
