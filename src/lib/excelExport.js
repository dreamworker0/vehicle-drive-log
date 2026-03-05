/**
 * 엑셀 다운로드 유틸리티
 * 운행일지 데이터를 엑셀 파일로 내보냅니다.
 */

import * as XLSX from 'xlsx';

/**
 * 운행일지 데이터를 엑셀 파일로 다운로드
 * @param {Array} logs - 운행일지 배열
 * @param {string} filename - 파일명 (확장자 제외)
 */
export function downloadDriveLogsExcel(logs, filename = '운행일지', { onError } = {}) {
    if (!logs || logs.length === 0) {
        onError?.('다운로드할 데이터가 없습니다.');
        return false;
    }

    // 데이터 변환
    const rows = logs.map(log => {
        const distance = ((log.arrivalKm || log.endKm || 0) - (log.departureKm || log.startKm || 0));
        const dateStr = log.date || (log.timestamp?.toDate
            ? log.timestamp.toDate().toISOString().slice(0, 10)
            : '-');

        return {
            '날짜': dateStr,
            '운전자': log.driverName || '',
            '차량': log.vehicleDisplayName || log.vehicleName || '',
            '출발시각': log.startTime || log.departureTime || '',
            '도착시각': log.endTime || log.arrivalTime || '',
            '목적지': log.destination || '',
            '사용목적': log.purpose || '',
            '출발Km': log.departureKm ?? log.startKm ?? '',
            '도착Km': log.arrivalKm ?? log.endKm ?? '',
            '주행거리(km)': distance > 0 ? distance : '',
            '탑승인원': log.passengerCount ?? '',
            '주유/충전금액': log.energyCost ?? '',
            '비고': log.notes || '',
        };
    });

    // 워크시트 생성
    const ws = XLSX.utils.json_to_sheet(rows);

    // 열 너비 설정
    ws['!cols'] = [
        { wch: 12 },  // 날짜
        { wch: 10 },  // 운전자
        { wch: 14 },  // 차량
        { wch: 8 },   // 출발시각
        { wch: 8 },   // 도착시각
        { wch: 20 },  // 목적지
        { wch: 14 },  // 사용목적
        { wch: 10 },  // 출발Km
        { wch: 10 },  // 도착Km
        { wch: 12 },  // 주행거리
        { wch: 8 },   // 탑승인원
        { wch: 12 },  // 주유/충전금액
        { wch: 20 },  // 비고
    ];

    // 워크북 생성 및 다운로드
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '운행일지');
    XLSX.writeFile(wb, `${filename}.xlsx`);
}
