/**
 * 엑셀 다운로드 유틸리티
 * 운행일지 데이터를 엑셀 파일로 내보냅니다.
 * xlsx 라이브러리는 동적 import로 필요 시에만 로드합니다 (276KB 절약).
 */
import {
    resolveStartKm, resolveEndKm, resolveDistance, resolveDateStr, resolveStartTime, resolveEndTime,
} from './driveLogExportFields';

/**
 * 운행일지 데이터를 엑셀 파일로 다운로드
 * @param {Array} logs - 운행일지 배열
 * @param {string} filename - 파일명 (확장자 제외)
 */
interface ExcelDriveLog {
    date?: string;
    timestamp?: { toDate?: () => Date };
    driverName?: string;
    vehicleDisplayName?: string;
    vehicleName?: string;
    startTime?: string;
    endTime?: string;
    departureTime?: string;
    arrivalTime?: string;
    destination?: string;
    purpose?: string;
    departureKm?: number;
    arrivalKm?: number;
    startKm?: number;
    endKm?: number;
    passengerCount?: number;
    passengerNames?: string[];
    hipassCardNumber?: string;
    hipassBalanceBefore?: number;
    hipassBalanceAfter?: number;
    fuelSummary?: string;
    notes?: string;
    [key: string]: unknown;
}

export async function downloadDriveLogsExcel(logs: ExcelDriveLog[], filename = '운행일지', { onError, includeHipass = false, includePassengers = false, includeFuel = false }: { onError?: (msg: string) => void; includeHipass?: boolean; includePassengers?: boolean; includeFuel?: boolean } = {}) {
    if (!logs || logs.length === 0) {
        onError?.('다운로드할 데이터가 없습니다.');
        return false;
    }

    // xlsx 라이브러리 동적 로드
    const XLSX = await import('xlsx');

    // 데이터 변환
    const rows = logs.map((log: ExcelDriveLog) => {
        const distance = resolveDistance(log);

        const row: Record<string, string | number> = {
            '날짜': resolveDateStr(log, '-'),
            '출발시각': resolveStartTime(log),
            '도착시각': resolveEndTime(log),
            '운전자': log.driverName || '',
            '차량': log.vehicleDisplayName || log.vehicleName || '',
            '목적지': log.destination || '',
            '사용목적': log.purpose || '',
            '출발Km': resolveStartKm(log) ?? '',
            '도착Km': resolveEndKm(log) ?? '',
            '주행거리(km)': distance > 0 ? distance : '',
            '탑승인원': log.passengerCount ?? '',
        };

        if (includeFuel) {
            row['주유금액(주유량)'] = log.fuelSummary || '';
        }

        if (includeHipass) {
            row['하이패스카드'] = log.hipassCardNumber || '';
            row['사용전금액'] = log.hipassBalanceBefore != null ? log.hipassBalanceBefore : '';
            row['사용후금액'] = log.hipassBalanceAfter != null ? log.hipassBalanceAfter : '';
        }

        if (includePassengers) {
            row['동행자'] = log.passengerNames && log.passengerNames.length > 0 ? log.passengerNames.join(', ') : '';
        }

        row['비고'] = log.notes || '';
        return row;
    });

    // 워크시트 생성
    const ws = XLSX.utils.json_to_sheet(rows);

    // 열 너비 설정
    const cols = [
        { wch: 12 },  // 날짜
        { wch: 6 },   // 출발시각
        { wch: 6 },   // 도착시각
        { wch: 10 },  // 운전자
        { wch: 14 },  // 차량
        { wch: 28 },  // 목적지
        { wch: 22 },  // 사용목적
        { wch: 8 },   // 출발Km
        { wch: 8 },   // 도착Km
        { wch: 8 },   // 주행거리
        { wch: 8 },   // 탑승인원
    ];
    if (includeFuel) {
        cols.push({ wch: 16 });  // 주유금액(주유량)
    }
    if (includeHipass) {
        cols.push({ wch: 20 });  // 하이패스카드
        cols.push({ wch: 12 });  // 사용전금액
        cols.push({ wch: 12 });  // 사용후금액
    }
    if (includePassengers) {
        cols.push({ wch: 20 });  // 동행자
    }
    cols.push({ wch: 20 });  // 비고
    ws['!cols'] = cols;

    // 워크북 생성 및 다운로드
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '운행일지');
    XLSX.writeFile(wb, `${filename}.xlsx`);
}

/**
 * 정비 기록 엑셀 다운로드용 인터페이스
 */
interface ExcelMaintenanceRecord {
    date?: string;
    vehicleName?: string;
    type?: string;
    cost?: number;
    shop?: string;
    km?: number;
    nextDueKm?: number;
    nextDueDate?: string;
    description?: string;
    blockVehicle?: boolean;
    [key: string]: unknown;
}

/**
 * 정비 기록 데이터를 엑셀 파일로 다운로드
 * @param records - 정비 기록 배열
 * @param filename - 파일명 (확장자 제외)
 * @param typeLabels - type 값 → 한글 라벨 매핑 (예: { oil: '엔진오일' })
 */
export async function downloadMaintenanceExcel(
    records: ExcelMaintenanceRecord[],
    filename = '정비기록',
    { onError, typeLabels = {} }: { onError?: (msg: string) => void; typeLabels?: Record<string, string> } = {},
) {
    if (!records || records.length === 0) {
        onError?.('다운로드할 데이터가 없습니다.');
        return false;
    }

    const XLSX = await import('xlsx');

    const rows = records.map((rec) => ({
        '날짜': rec.date || '',
        '차량': rec.vehicleName || '',
        '정비유형': typeLabels[rec.type || ''] || rec.type || '',
        '비용(원)': rec.cost ? rec.cost : '',
        '정비소': rec.shop || '',
        '현재km': rec.km ? rec.km : '',
        '다음정비km': rec.nextDueKm ? rec.nextDueKm : '',
        '다음정비일': rec.nextDueDate || '',
        '메모': rec.description || '',
        '차량차단': rec.blockVehicle ? 'O' : '',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);

    ws['!cols'] = [
        { wch: 12 },  // 날짜
        { wch: 14 },  // 차량
        { wch: 12 },  // 정비유형
        { wch: 12 },  // 비용
        { wch: 16 },  // 정비소
        { wch: 10 },  // 현재km
        { wch: 12 },  // 다음정비km
        { wch: 12 },  // 다음정비일
        { wch: 24 },  // 메모
        { wch: 8 },   // 차량차단
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '정비기록');
    XLSX.writeFile(wb, `${filename}.xlsx`);
}

/**
 * 주유 기록 엑셀 다운로드용 인터페이스
 */
interface ExcelFuelLog {
    date?: string;
    createdAt?: unknown;
    vehicleName?: string;
    driverName?: string;
    meterReading?: number;
    fuelType?: string;
    fuelAmount?: number;
    fuelCost?: number;
    notes?: string;
    [key: string]: unknown;
}

/**
 * 주유 기록 데이터를 엑셀 파일로 다운로드
 */
export async function downloadFuelLogsExcel(
    records: ExcelFuelLog[],
    filename = '주유기록',
    { onError }: { onError?: (msg: string) => void } = {},
) {
    if (!records || records.length === 0) {
        onError?.('다운로드할 데이터가 없습니다.');
        return false;
    }

    const XLSX = await import('xlsx');

    const rows = records.map((rec) => {
        let timeStr = '';
        if (rec.createdAt) {
            const ca = rec.createdAt as { seconds: number; toDate?: () => Date } | undefined;
            const d = ca instanceof Date ? ca : ca?.toDate?.() || null;
            if (d) timeStr = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
        }
        const isChargeable = ['electric', 'hydrogen'].includes(rec.fuelType || '');
        const unit = isChargeable ? (rec.fuelType === 'hydrogen' ? 'kg' : 'kWh') : 'L';
        return {
            '날짜': rec.date || '',
            '시각': timeStr,
            '차량': rec.vehicleName || '',
            '주유/충전원': rec.driverName || '',
            '주유미터(km)': rec.meterReading ? rec.meterReading : '',
            [`주유/충전량`]: rec.fuelAmount ? `${rec.fuelAmount} ${unit}` : '',
            '주유/충전금액(원)': rec.fuelCost ? rec.fuelCost : '',
            '비고': rec.notes || '',
        };
    });

    const ws = XLSX.utils.json_to_sheet(rows);

    ws['!cols'] = [
        { wch: 12 },  // 날짜
        { wch: 8 },   // 시각
        { wch: 14 },  // 차량
        { wch: 10 },  // 주유/충전원
        { wch: 12 },  // 주유미터
        { wch: 12 },  // 주유/충전량
        { wch: 14 },  // 주유/충전금액
        { wch: 24 },  // 비고
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '주유충전기록');
    XLSX.writeFile(wb, `${filename}.xlsx`);
}

/**
 * 하이패스 충전 기록 엑셀 다운로드용 인터페이스
 */
interface ExcelHipassCharge {
    date?: string;
    createdAt?: unknown;
    vehicleName?: string;
    chargerName?: string;
    cardNumber?: string;
    chargeAmount?: number;
    balanceBefore?: number;
    balanceAfter?: number;
}

/**
 * 하이패스 충전 기록 데이터를 엑셀 파일로 다운로드
 */
export async function downloadHipassChargesExcel(
    records: ExcelHipassCharge[],
    filename = '하이패스충전기록',
    { onError }: { onError?: (msg: string) => void } = {},
) {
    if (!records || records.length === 0) {
        onError?.('다운로드할 데이터가 없습니다.');
        return false;
    }

    const XLSX = await import('xlsx');

    const rows = records.map((rec) => {
        let timeStr = '';
        if (rec.createdAt) {
            const ca = rec.createdAt as { seconds: number; toDate?: () => Date } | undefined;
            const d = ca instanceof Date ? ca : ca?.toDate?.() || null;
            if (d) timeStr = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
        }
        return {
            '날짜': rec.date || '',
            '시각': timeStr,
            '충전자': rec.chargerName || '',
            '차량': rec.vehicleName || '',
            '하이패스 카드': rec.cardNumber || '',
            '충전금액(원)': rec.chargeAmount ? rec.chargeAmount : '',
            '충전전잔액(원)': rec.balanceBefore != null ? rec.balanceBefore : '',
            '충전후잔액(원)': rec.balanceAfter != null ? rec.balanceAfter : '',
        };
    });

    const ws = XLSX.utils.json_to_sheet(rows);

    ws['!cols'] = [
        { wch: 12 },  // 날짜
        { wch: 8 },   // 시각
        { wch: 10 },  // 충전자
        { wch: 14 },  // 차량
        { wch: 20 },  // 하이패스 카드
        { wch: 12 },  // 충전금액
        { wch: 14 },  // 충전전잔액
        { wch: 14 },  // 충전후잔액
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '하이패스충전기록');
    XLSX.writeFile(wb, `${filename}.xlsx`);
}
