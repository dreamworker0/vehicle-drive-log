/**
 * PDF 일별일지 다운로드 유틸리티
 * 종이 양식 기반의 일별 차량 운행일지를 브라우저 인쇄 기능으로 PDF 생성
 * A4 세로 (portrait)
 */
import { formatNumber, escapeHtml } from './pdfStyles';

interface DailyDriveEntry {
    driverName?: string;
    passengers?: number;
    purpose?: string;
    destination?: string;
    startTime?: string;
    endTime?: string;
    startKm?: number;
    endKm?: number;
}

interface DailyFuelEntry {
    driverName?: string;
    meterReading?: number;
    fuelAmount?: number;
    fuelCost?: number;
}

interface ApprovalEntry {
    title: string;
}

interface DailyLogPdfOptions {
    orgName?: string;
    vehicleName?: string;
    date?: string;
    todayDistance?: number;
    previousEndKm?: number | null;
    todayEndKm?: number | null;
    approvalLine?: ApprovalEntry[];
    onError?: (msg: string) => void;
}

const MAX_ROWS = 12;

/**
 * 일별일지 PDF 내보내기
 */
export function downloadDailyLogPdf(
    driveLogs: DailyDriveEntry[],
    fuelLogs: DailyFuelEntry[],
    options: DailyLogPdfOptions = {},
) {
    if (!driveLogs || driveLogs.length === 0) {
        options.onError?.('운행 기록이 없습니다.');
        return false;
    }

    const htmlContent = buildDailyPdfHtml(driveLogs, fuelLogs, options);

    const printWindow = window.open('', '_blank', 'width=900,height=1000');
    if (!printWindow) {
        options.onError?.('팝업이 차단되었습니다. 팝업 허용 후 다시 시도해주세요.');
        return false;
    }

    printWindow.document.write(htmlContent);
    printWindow.document.close();

    printWindow.onload = () => {
        setTimeout(() => {
            printWindow.print();
        }, 300);
    };
}

function formatDateKorean(dateStr: string | undefined): string {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    return `${parts[0]}년 ${parseInt(parts[1])}월 ${parseInt(parts[2])}일`;
}

function buildApprovalHtml(approvalLine: ApprovalEntry[]) {
    if (!approvalLine || approvalLine.length === 0) return '';
    return `
        <table class="approval-table">
            <tr>
                <th class="approval-header" rowspan="2">결<br/>재</th>
                ${approvalLine.map(a => `<td class="approval-title">${escapeHtml(a.title || '')}</td>`).join('')}
            </tr>
            <tr>
                ${approvalLine.map(() => `<td class="approval-sign">&nbsp;</td>`).join('')}
            </tr>
        </table>
    `;
}

function buildSummaryHtml(
    todayDistance: number,
    previousEndKm: number | null,
    todayEndKm: number | null,
    fuel: DailyFuelEntry | null,
) {
    const hasFuel = fuel !== null;

    return `
        <table class="summary-table">
            <colgroup>
                <col style="width:5%" />
                <col style="width:14%" />
                <col style="width:18%" />
                ${hasFuel ? `
                <col style="width:5%" />
                <col style="width:14%" />
                <col style="width:18%" />
                ` : ''}
            </colgroup>
            <tr>
                <th class="section-header" rowspan="4">운<br/>행<br/>상<br/>황</th>
                <td class="label-cell">구 분</td>
                <td class="label-cell">운행거리</td>
                ${hasFuel ? `<th class="fuel-header" rowspan="4">주<br/>유<br/>상<br/>황</th>` : ''}
                ${hasFuel ? `<td class="fuel-label">주유원</td><td class="fuel-value">${escapeHtml(fuel!.driverName || '')}</td>` : ''}
            </tr>
            <tr>
                <td class="label-cell">금 일</td>
                <td class="value-cell right">${formatNumber(todayDistance)} km</td>
                ${hasFuel ? `<td class="fuel-label">주유미터(km)</td><td class="fuel-value right">${formatNumber(fuel!.meterReading)}</td>` : ''}
            </tr>
            <tr>
                <td class="label-cell">전일 누계</td>
                <td class="value-cell right">${previousEndKm !== null ? formatNumber(previousEndKm) : '-'} km</td>
                ${hasFuel ? `<td class="fuel-label">주유량(ℓ)</td><td class="fuel-value right">${fuel!.fuelAmount || ''}</td>` : ''}
            </tr>
            <tr>
                <td class="label-cell">금일 누계</td>
                <td class="value-cell right">${todayEndKm !== null ? formatNumber(todayEndKm) : '-'} km</td>
                ${hasFuel ? `<td class="fuel-label">주유금액</td><td class="fuel-value right">${fuel!.fuelCost ? fuel!.fuelCost.toLocaleString() : ''}</td>` : ''}
            </tr>
        </table>
    `;
}


function buildDriveRow(log: DailyDriveEntry) {
    const distance = ((log.endKm || 0) - (log.startKm || 0));
    const timeStr = (log.startTime && log.endTime)
        ? `${log.startTime}-${log.endTime}`
        : (log.startTime || log.endTime || '');

    return `
        <tr>
            <td class="center">${escapeHtml(log.driverName || '')}</td>
            <td class="center">${log.passengers || ''}</td>
            <td>${escapeHtml(log.purpose || '')}</td>
            <td>${escapeHtml(log.destination || '')}</td>
            <td class="center nowrap">${escapeHtml(timeStr)}</td>
            <td class="right">${distance > 0 ? formatNumber(distance) : ''}</td>
            <td class="right">${log.endKm ? formatNumber(log.endKm) : ''}</td>
        </tr>
    `;
}

function buildEmptyRows(count: number) {
    return Array(count).fill(null).map(() => `
        <tr>
            <td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>
            <td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>
        </tr>
    `).join('');
}

function buildDailyPdfHtml(
    driveLogs: DailyDriveEntry[],
    fuelLogs: DailyFuelEntry[],
    options: DailyLogPdfOptions,
) {
    const {
        orgName = '', vehicleName = '', date = '',
        todayDistance = 0, previousEndKm = null, todayEndKm = null,
        approvalLine = [],
    } = options;

    const approvalHtml = buildApprovalHtml(approvalLine);
    const fuel = fuelLogs.length > 0 ? fuelLogs[0] : null;
    const summaryHtml = buildSummaryHtml(todayDistance, previousEndKm, todayEndKm, fuel);

    const rowsHtml = driveLogs.map(log => buildDriveRow(log)).join('');
    const emptyCount = Math.max(0, MAX_ROWS - driveLogs.length);
    const emptyRowsHtml = buildEmptyRows(emptyCount);

    return `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <title>차량운행일지 - ${escapeHtml(orgName)} - ${escapeHtml(date)}</title>
    <style>${getDailyPdfStyles()}</style>
</head>
<body>
    <div class="page">
        <div class="header-area">
            <h1 class="title">일 별 차 량 운 행 일 지</h1>
            ${approvalHtml}
        </div>

        <div class="date-org-row">
            <span class="date-text">날짜 &nbsp; <strong>${escapeHtml(formatDateKorean(date))}</strong> &nbsp;&nbsp;&nbsp; 차량 &nbsp; <strong>${escapeHtml(vehicleName)}</strong></span>
            <span class="org-text">기관명 &nbsp; <strong>${escapeHtml(orgName)}</strong></span>
        </div>

        ${summaryHtml}


        <table class="log-table">
            <thead>
                <tr>
                    <th class="col-driver">사용자</th>
                    <th class="col-pax">탑승<br/>인원</th>
                    <th class="col-purpose">용무</th>
                    <th class="col-dest">목적지</th>
                    <th class="col-time">운행 시간</th>
                    <th class="col-km">운행거리<br/>(km)</th>
                    <th class="col-cumkm">운행거리<br/>누계(km)</th>
                </tr>
            </thead>
            <tbody>
                ${rowsHtml}
                ${emptyRowsHtml}
            </tbody>
        </table>
    </div>
</body>
</html>
    `;
}

function getDailyPdfStyles() {
    return `
        @page {
            size: A4 portrait;
            margin: 15mm 14mm 12mm 14mm;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: 'Malgun Gothic', '맑은 고딕', 'Noto Sans KR', sans-serif;
            font-size: 10px;
            color: #111;
            background: #fff;
        }

        .page { width: 100%; }

        /* ── 헤더 ── */
        .header-area {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            margin-bottom: 14px;
        }

        .title {
            font-size: 22px;
            font-weight: 800;
            letter-spacing: 10px;
            padding-top: 6px;
        }

        /* 결재 */
        .approval-table { border-collapse: collapse; margin-top: 2px; }
        .approval-table td, .approval-table th {
            border: 1px solid #333;
            text-align: center;
            font-size: 9px;
            padding: 2px 6px;
        }
        .approval-header {
            background: #e8e8e8;
            font-weight: 700; width: 22px;
            padding: 2px 4px; line-height: 1.4;
        }
        .approval-title {
            background: #f5f5f5;
            font-weight: 600; min-width: 52px; height: 18px;
        }
        .approval-sign { height: 40px; min-width: 52px; }

        /* ── 날짜 / 기관 줄 ── */
        .date-org-row {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            margin-bottom: 8px;
            font-size: 12px;
        }
        .date-text { font-size: 13px; }
        .org-text { font-size: 11px; }

        /* ── 운행상황 + 주유 요약 테이블 ── */
        .summary-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 10px;
            margin-bottom: 10px;
        }
        .summary-table th,
        .summary-table td {
            border: 1px solid #333;
            padding: 5px 8px;
            vertical-align: middle;
        }
        .section-header {
            background: #e8e8e8;
            font-weight: 700;
            text-align: center;
            width: 30px;
            font-size: 10px;
            line-height: 1.6;
        }
        .label-cell {
            text-align: center;
            font-weight: 600;
            font-size: 10px;
            white-space: nowrap;
            background: #f5f5f5;
        }
        .value-cell {
            font-size: 11px;
            font-weight: 500;
        }
        .fuel-header {
            background: #e8e8e8;
            font-weight: 700;
            text-align: center;
            width: 40px;
            font-size: 9px;
            line-height: 1.5;
        }
        .fuel-label {
            background: #f5f5f5;
            font-weight: 600;
            font-size: 9.5px;
            text-align: center;
            white-space: nowrap;
        }
        .fuel-value {
            font-size: 10px;
        }

        /* ── 차량 줄 ── */
        .vehicle-row {
            font-size: 11px;
            margin-bottom: 6px;
            padding-left: 2px;
        }

        /* ── 운행 기록 테이블 ── */
        .log-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 10px;
            table-layout: fixed;
        }
        .log-table th, .log-table td {
            border: 1px solid #333;
            padding: 4px 5px;
            vertical-align: middle;
            word-break: break-all;
        }
        .log-table thead th {
            background: #e8e8e8;
            font-weight: 700;
            text-align: center;
            font-size: 9.5px;
            height: 32px;
        }
        .log-table tbody td {
            height: 28px;
            font-size: 9.5px;
        }

        .col-driver  { width: 52px; }
        .col-pax     { width: 32px; }
        .col-purpose { width: 60px; }
        .col-dest    { width: auto; }
        .col-time    { width: 78px; }
        .col-km      { width: 56px; }
        .col-cumkm   { width: 66px; }

        .center { text-align: center; }
        .right  { text-align: right; }
        .nowrap { white-space: nowrap; }

        @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }

        @media screen {
            body { padding: 20px; background: #e0e0e0; }
            .page {
                background: #fff;
                padding: 28px 32px;
                box-shadow: 0 2px 12px rgba(0,0,0,0.18);
                max-width: 700px;
                margin: 0 auto;
            }
        }
    `;
}
