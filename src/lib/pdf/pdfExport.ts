/**
 * PDF 운행일지 다운로드 유틸리티
 * 공식 차량운행일지 양식을 브라우저 인쇄 기능으로 PDF 생성
 */
import { getPdfStyles, formatDate, formatNumber } from './pdfStyles';

/** PDF용 운행일지 행 */
interface PdfLogEntry {
    date?: string;
    timestamp?: { toDate?: () => Date };
    driverName?: string;
    vehicleDisplayName?: string;
    vehicleName?: string;
    destination?: string;
    purpose?: string;
    startTime?: string;
    departureTime?: string;
    endTime?: string;
    arrivalTime?: string;
    departureKm?: number;
    startKm?: number;
    arrivalKm?: number;
    endKm?: number;
    passengerCount?: number;
    passengerNames?: string[];
    hipassCardNumber?: string;
    hipassBalanceBefore?: number;
    hipassBalanceAfter?: number;
    notes?: string;
}

/** 결재라인 항목 */
interface ApprovalEntry {
    title: string;
}

// 페이지당 행 수
const ROWS_PER_PAGE = 19;

/**
 * 운행일지 데이터를 PDF로 내보내기 (브라우저 인쇄 → PDF 저장)
 * @param {Array} logs - 운행일지 배열
 * @param {Object} options - 옵션
 * @param {string} options.orgName - 기관명
 * @param {string} options.period - 기간 문자열
 */
export function downloadDriveLogsPdf(logs: PdfLogEntry[], options: { onError?: (msg: string) => void; orgName?: string; period?: string; approvalLine?: ApprovalEntry[]; includeHipass?: boolean; includePassengers?: boolean } = {}) {
    if (!logs || logs.length === 0) {
        options.onError?.('다운로드할 데이터가 없습니다.');
        return false;
    }

    const { orgName = '', period = '', approvalLine = [], includeHipass = false, includePassengers = false } = options;

    // 날짜순 정렬 (오래된 순), 같은 날짜 내 출발 시간 오름차순
    const sorted = [...logs].sort((a, b) => {
        const dateA = a.date || (a.timestamp?.toDate ? a.timestamp.toDate().toISOString().slice(0, 10) : '');
        const dateB = b.date || (b.timestamp?.toDate ? b.timestamp.toDate().toISOString().slice(0, 10) : '');
        const dateCmp = dateA.localeCompare(dateB);
        if (dateCmp !== 0) return dateCmp;
        const timeA = a.startTime || a.departureTime || '';
        const timeB = b.startTime || b.departureTime || '';
        return timeA.localeCompare(timeB);
    });

    // 페이지 분할
    const pages: PdfLogEntry[][] = [];
    for (let i = 0; i < sorted.length; i += ROWS_PER_PAGE) {
        pages.push(sorted.slice(i, i + ROWS_PER_PAGE));
    }

    const htmlContent = buildPdfHtml(pages, { orgName, period, approvalLine, includeHipass, includePassengers });

    // 새 창에서 인쇄
    const printWindow = window.open('', '_blank', 'width=1100,height=800');
    if (!printWindow) {
        options.onError?.('팝업이 차단되었습니다. 팝업 허용 후 다시 시도해주세요.');
        return false;
    }

    printWindow.document.write(htmlContent);
    printWindow.document.close();

    // 렌더링 후 인쇄 다이얼로그 실행
    printWindow.onload = () => {
        setTimeout(() => {
            printWindow.print();
        }, 300);
    };
}

/**
 * 운행일지 데이터 행을 HTML TR로 변환
 */
function buildLogRow(log: PdfLogEntry, idx: number, pageIdx: number, includeHipass = false, includePassengers = false) {
    const date = log.date || (log.timestamp?.toDate
        ? log.timestamp.toDate().toISOString().slice(0, 10)
        : '-');
    const distance = ((log.arrivalKm || log.endKm || 0) - (log.departureKm || log.startKm || 0));

    // 하이패스 정보를 비고에 합침
    let noteText = log.notes || '';
    if (includeHipass && log.hipassCardNumber) {
        const hipassInfo = `[하이패스] ${log.hipassBalanceBefore?.toLocaleString() ?? ''}→${log.hipassBalanceAfter?.toLocaleString() ?? ''}원`;
        noteText = noteText ? `${noteText} / ${hipassInfo}` : hipassInfo;
    }

    return `
        <tr>
            <td class="center">${idx + 1 + (pageIdx * ROWS_PER_PAGE)}</td>
            <td class="center">${formatDate(date)}</td>
            <td class="center">${log.startTime || log.departureTime || ''}</td>
            <td class="center">${log.endTime || log.arrivalTime || ''}</td>
            <td class="center">${log.driverName || ''}</td>
            <td class="center">${log.vehicleDisplayName || log.vehicleName || ''}</td>
            <td>${log.destination || ''}</td>
            <td>${log.purpose || ''}</td>
            <td class="right">${formatNumber(log.departureKm ?? log.startKm)}</td>
            <td class="right">${formatNumber(log.arrivalKm ?? log.endKm)}</td>
            <td class="right">${distance > 0 ? distance.toLocaleString() : ''}</td>
            <td class="center">${log.passengerCount || ''}</td>
            ${includePassengers ? `<td class="center" style="font-size: 8px;">${log.passengerNames?.join(', ') || ''}</td>` : ''}
            <td>${noteText}</td>
        </tr>
    `;
}

/**
 * 빈 행 HTML (19행 맞추기)
 */
function buildEmptyRows(count: number, includePassengers = false) {
    return Array(count).fill(null).map(() => `
        <tr>
            <td class="center">&nbsp;</td>
            <td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>
            <td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>
            <td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>
            ${includePassengers ? '<td>&nbsp;</td>' : ''}
            <td>&nbsp;</td>
        </tr>
    `).join('');
}

/**
 * 결재란 HTML 생성
 */
function buildApprovalHtml(approvalLine: ApprovalEntry[]) {
    if (!approvalLine || approvalLine.length === 0) return '';
    return `
        <table class="approval-table">
            <tr>
                <th class="approval-header" rowspan="2">결<br/>재</th>
                ${approvalLine.map(a => `<td class="approval-title">${a.title || ''}</td>`).join('')}
            </tr>
            <tr>
                ${approvalLine.map(() => `<td class="approval-sign">&nbsp;</td>`).join('')}
            </tr>
        </table>
    `;
}

/**
 * 단일 페이지 HTML 생성
 */
function buildPageHtml(pageRows: PdfLogEntry[], pageIdx: number, totalPages: number, { orgName, period, approvalLine, includeHipass = false, includePassengers = false, totalAllDistance = 0 }: { orgName: string; period: string; approvalLine: ApprovalEntry[]; includeHipass?: boolean; includePassengers?: boolean; totalAllDistance?: number }) {
    const pageNum = pageIdx + 1;
    const pageTotalDistance = pageRows.reduce((sum, log) => {
        const d = ((log.arrivalKm || log.endKm || 0) - (log.departureKm || log.startKm || 0));
        return sum + (d > 0 ? d : 0);
    }, 0);

    const rowsHtml = pageRows.map((log: PdfLogEntry, idx: number) => buildLogRow(log, idx, pageIdx, includeHipass, includePassengers)).join('');
    const emptyRowsHtml = buildEmptyRows(ROWS_PER_PAGE - pageRows.length, includePassengers);
    const approvalHtml = buildApprovalHtml(approvalLine);

    return `
        <div class="page">
            <div class="header-area">
                <h1 class="title">차량운행일지</h1>
                ${approvalHtml}
            </div>
            <div class="info-row">
                <div class="info-left">
                    <span class="info-label">기관명</span>
                    <span class="info-value">${orgName}</span>
                </div>
                <div class="info-right">
                    <span class="info-label">기간</span>
                    <span class="info-value">${period}</span>
                    <span class="page-num">(${pageNum} / ${totalPages})</span>
                </div>
            </div>
            <table class="log-table">
                <thead>
                    <tr>
                        <th rowspan="2" class="col-no">No.</th>
                        <th rowspan="2" class="col-date">날짜</th>
                        <th colspan="2">시각</th>
                        <th rowspan="2" class="col-driver">운전자</th>
                        <th rowspan="2" class="col-vehicle">차량</th>
                        <th rowspan="2" class="col-dest">목적지</th>
                        <th rowspan="2" class="col-purpose">사용목적</th>
                        <th colspan="3">주행거리 (km)</th>
                        <th rowspan="2" class="col-passenger">탑승<br/>인원</th>
                        ${includePassengers ? '<th rowspan="2" class="col-passengers">동행자</th>' : ''}
                        <th rowspan="2" class="col-note">비고</th>
                    </tr>
                    <tr>
                        <th class="col-time">출발</th>
                        <th class="col-time">도착</th>
                        <th class="col-km">출발</th>
                        <th class="col-km">도착</th>
                        <th class="col-km">주행</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                    ${emptyRowsHtml}
                    <tr class="total-row">
                        <td colspan="10" class="center total-label">소 계</td>
                        <td class="right total-value">${pageTotalDistance > 0 ? pageTotalDistance.toLocaleString() : ''}</td>
                        <td></td>
                        ${includePassengers ? '<td></td>' : ''}
                        <td></td>
                    </tr>
                    ${pageIdx === totalPages - 1 ? `
                    <tr class="total-row" style="font-weight:bold; background:#e8f0fe;">
                        <td colspan="10" class="center total-label">합 계</td>
                        <td class="right total-value">${totalAllDistance > 0 ? totalAllDistance.toLocaleString() : ''}</td>
                        <td></td>
                        ${includePassengers ? '<td></td>' : ''}
                        <td></td>
                    </tr>` : ''}
                </tbody>
            </table>
        </div>
    `;
}

/**
 * 전체 HTML 문서 생성
 */
function buildPdfHtml(pages: PdfLogEntry[][], options: { orgName: string; period: string; approvalLine: ApprovalEntry[]; includeHipass?: boolean; includePassengers?: boolean }) {
    const totalPages = pages.length;
    // 전체 페이지에 걸친 총 주행거리 합계
    const totalAllDistance = pages.flat().reduce((sum, log) => {
        const d = ((log.arrivalKm || log.endKm || 0) - (log.departureKm || log.startKm || 0));
        return sum + (d > 0 ? d : 0);
    }, 0);
    const pagesHtml = pages.map((pageRows, pageIdx) =>
        buildPageHtml(pageRows, pageIdx, totalPages, { ...options, totalAllDistance })
    ).join('');

    return `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <title>차량운행일지 - ${options.orgName}</title>
    <style>${getPdfStyles()}</style>
</head>
<body>
    ${pagesHtml}
</body>
</html>
    `;
}
