/**
 * PDF 일별일지 다운로드 유틸리티
 * 종이 양식 기반의 일별 차량 운행일지를 브라우저 인쇄 기능으로 PDF 생성
 * A4 세로 (portrait)
 */
import { formatNumber, escapeHtml } from './pdfStyles';
import { measurePageMetrics, paginateByHeight, A4_PORTRAIT_DAILY_BOX } from './pageFit';
import { recordExport } from '../audit/recordExport';
import { formatFuelAmount } from '../fuelFormat';

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
    /**
     * 출발지 이름 — 분관을 등록한 기관에서만 들어온다.
     * 일별일지는 차량 하나·하루치라 출발지가 행마다 같다. 그래서 열을 만들지 않고
     * 차량명 옆에 한 번만 적는다(관공서에 제출하는 서식의 칸 수를 건드리지 않는다).
     */
    startLocation?: string;
    date?: string;
    todayDistance?: number;
    previousEndKm?: number | null;
    todayEndKm?: number | null;
    approvalLine?: ApprovalEntry[];
    onError?: (msg: string) => void;
}

/** 종이 양식의 칸 수 — 페이지당 데이터 행의 **상한**이자 빈 칸을 채우는 기준 */
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

    // 접속기록 — 반출 건수는 운행일지 기준(주유는 부속 정보로 함께 실린다).
    recordExport('pdf', 'dailyLogs', driveLogs.length);
}

function formatDateKorean(dateStr: string | undefined): string {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    return `${parts[0]}년 ${parseInt(parts[1])}월 ${parseInt(parts[2])}일`;
}

/**
 * 결재란 HTML 생성
 *
 * @param hidden 자리는 두고 표만 감춘다 — 결재란은 첫 장에만 찍고(도장을 어디에 찍을지
 *               모호해진다), 자리를 없애면 표 시작 높이가 장마다 달라져 양식이 어긋난다.
 */
function buildApprovalHtml(approvalLine: ApprovalEntry[], hidden = false) {
    if (!approvalLine || approvalLine.length === 0) return '';
    return `
        <table class="approval-table${hidden ? ' approval-hidden' : ''}"${hidden ? ' aria-hidden="true"' : ''}>
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
                ${hasFuel ? `<td class="fuel-label">주유량(ℓ)</td><td class="fuel-value right">${fuel!.fuelAmount ? formatFuelAmount(fuel!.fuelAmount) : ''}</td>` : ''}
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
            <td class="center">${escapeHtml(log.passengers || '')}</td>
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

/** 한 장에 담을 내용 — 실측 분할이 정한다 */
interface DailyPage {
    logs: DailyDriveEntry[];
    /** 아래를 채울 빈 행 수 — 양식 칸 수(12)를 유지한다 */
    emptyCount: number;
}

function buildDailyPdfHtml(
    driveLogs: DailyDriveEntry[],
    fuelLogs: DailyFuelEntry[],
    options: DailyLogPdfOptions,
) {
    const {
        orgName = '', vehicleName = '', startLocation = '', date = '',
        todayDistance = 0, previousEndKm = null, todayEndKm = null,
        approvalLine = [],
    } = options;

    const fuel = fuelLogs.length > 0 ? fuelLogs[0] : null;
    const summaryHtml = buildSummaryHtml(todayDistance, previousEndKm, todayEndKm, fuel);

    /** 한 장 HTML — 측정용 문서와 실제 인쇄물이 같은 마크업을 써야 실측이 의미를 갖는다 */
    const buildPage = (page: DailyPage, pageIdx: number, totalPages: number) => `
    <div class="page">
        <div class="header-area">
            <h1 class="title">일 별 차 량 운 행 일 지</h1>
            ${buildApprovalHtml(approvalLine, pageIdx > 0)}
        </div>

        <div class="date-org-row">
            <span class="date-text">날짜 &nbsp; <strong>${escapeHtml(formatDateKorean(date))}</strong> &nbsp;&nbsp;&nbsp; 차량 &nbsp; <strong>${escapeHtml(vehicleName)}</strong>${startLocation ? ` &nbsp;&nbsp;&nbsp; 출발지 &nbsp; <strong>${escapeHtml(startLocation)}</strong>` : ''}</span>
            <span class="org-text">기관명 &nbsp; <strong>${escapeHtml(orgName)}</strong>${totalPages > 1 ? ` &nbsp; <span class="page-num">(${pageIdx + 1} / ${totalPages})</span>` : ''}</span>
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
                ${page.logs.map(log => buildDriveRow(log)).join('')}
                ${buildEmptyRows(page.emptyCount)}
            </tbody>
        </table>
    </div>`;

    const buildDoc = (pages: DailyPage[]) => `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <title>차량운행일지 - ${escapeHtml(orgName)} - ${escapeHtml(date)}</title>
    <style>${getDailyPdfStyles()}</style>
</head>
<body>
${pages.map((page, pageIdx) => buildPage(page, pageIdx, pages.length)).join('\n')}
</body>
</html>
    `;

    /**
     * 페이지 분할 — 한 장에 들어가는 높이만큼 담는다.
     *
     * 예전에는 `MAX_ROWS - driveLogs.length`로 빈 칸만 채우고 13건부터는 행을 그대로 다 찍었다.
     * 실측하면 짧은 목적지로도 30건에서 1,087px, 목적지·용무가 긴 하루는 **20건에서 1,867px**로
     * 한 장(1,020px)을 넘긴다. 넘친 장에는 제목도 결재란도 표 머리글도 없다.
     *
     * 12칸(`MAX_ROWS`)은 **빈 칸을 채우는 기준으로만** 쓴다 — 상한으로 두면 13건짜리 하루가
     * 한 장에 다 들어가는데도 두 장으로 나뉜다. 그래서 지금까지 잘 나오던 하루(1~29건, 짧은
     * 목적지)는 결과가 그대로이고, 넘치던 하루만 나뉜다.
     */
    const splitPages = (): DailyPage[] => {
        // 측정용: 전체 행 + 빈 행 1개(기준 높이)가 한 장에 담긴 문서. 합계 행은 이 양식에 없다.
        const probe = buildDoc([{ logs: driveLogs, emptyCount: 1 }]);
        const metrics = measurePageMetrics(probe, driveLogs.length, {
            trailing: { subtotal: false, total: false },
            box: A4_PORTRAIT_DAILY_BOX,
        });
        const slices = metrics
            ? paginateByHeight(metrics, { box: A4_PORTRAIT_DAILY_BOX, fillTo: MAX_ROWS })
            : [];

        if (slices.length > 0) {
            return slices.map(slice => ({
                logs: driveLogs.slice(slice.start, slice.start + slice.count),
                emptyCount: slice.emptyCount,
            }));
        }

        // 측정 불가 환경(jsdom 등): 예전처럼 전부 한 장에 담고 12칸까지 빈 칸을 채운다
        return [{ logs: driveLogs, emptyCount: Math.max(0, MAX_ROWS - driveLogs.length) }];
    };

    return buildDoc(splitPages());
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

        .page { width: 100%; page-break-after: always; }
        .page:last-child { page-break-after: auto; }

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
        /* 둘째 장 이후: 결재란은 감추고 자리(표 시작 높이)만 유지한다 */
        .approval-table.approval-hidden { visibility: hidden; }

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
        .page-num { font-size: 10px; color: #666; }

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
                margin: 0 auto 20px;
            }
        }
    `;
}
