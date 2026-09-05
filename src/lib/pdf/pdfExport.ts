/**
 * PDF 운행일지 다운로드 유틸리티
 * 공식 차량운행일지 양식을 브라우저 인쇄 기능으로 PDF 생성
 */
import { getPdfStyles, formatDate, formatNumber, escapeHtml } from './pdfStyles';
import { measurePageMetrics, paginateByHeight } from './pageFit';
import { recordExport } from '../audit/recordExport';
import {
    resolveStartKm, resolveEndKm, resolveDistance, resolveDateStr, resolveStartTime, resolveStartTimeRaw, resolveEndTime,
} from '../driveLogExportFields';
import type { FirestoreTimestamp } from '../../types/common';

/** PDF용 운행일지 행 */
interface PdfLogEntry {
    date?: string;
    timestamp?: FirestoreTimestamp;
    driverName?: string;
    vehicleDisplayName?: string;
    vehicleName?: string;
    destination?: string;
    /** 출발지 이름 — 분관을 등록한 기관의 기록에만 있다 */
    startLocation?: string;
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
    fuelSummary?: string;
    notes?: string;
}

/** 결재라인 항목 */
interface ApprovalEntry {
    title: string;
}

/**
 * 실측이 불가능할 때만 쓰는 되돌림 값 (페이지당 행 수)
 *
 * 평소에는 pageFit.ts가 실제 행 높이를 재서 나눈다. 이 값은 레이아웃을 잴 수 없는
 * 환경(테스트 등)에서만 쓰이며, 모든 행이 1줄일 때를 가정한 수치다.
 */
const FALLBACK_ROWS_PER_PAGE = 19;

/** 한 페이지에 담기는 내용 */
interface PageContent {
    rows: PdfLogEntry[];
    /** 전체 정렬 배열에서의 시작 인덱스 — 일련번호가 페이지를 넘어 이어지게 한다 */
    start: number;
    /** 아래를 채울 빈 행 수 */
    emptyCount: number;
}

/** 출발지가 기록된 행이 하나라도 있는가 (분관을 등록한 기관에서만 true) */
function hasStartLocation(logs: PdfLogEntry[]) {
    return logs.some(log => (log.startLocation || '').trim() !== '');
}

/**
 * 운행일지 데이터를 PDF로 내보내기 (브라우저 인쇄 → PDF 저장)
 * @param {Array} logs - 운행일지 배열
 * @param {Object} options - 옵션
 * @param {string} options.orgName - 기관명
 * @param {string} options.period - 기간 문자열
 */
export function downloadDriveLogsPdf(logs: PdfLogEntry[], options: { onError?: (msg: string) => void; orgName?: string; period?: string; approvalLine?: ApprovalEntry[]; includeHipass?: boolean; includePassengers?: boolean; includeFuel?: boolean } = {}) {
    if (!logs || logs.length === 0) {
        options.onError?.('다운로드할 데이터가 없습니다.');
        return false;
    }

    const { orgName = '', period = '', approvalLine = [], includeHipass = false, includePassengers = false, includeFuel = false } = options;

    // 출발지 열은 **기록에 있을 때만** 넣는다. 분관을 쓰지 않는 기관의 출력물은 예전과 한 칸도
    // 달라지지 않아야 한다(관공서에 그대로 제출하는 서식이다).
    const includeStartLocation = hasStartLocation(logs);

    // 날짜순 정렬 (오래된 순), 같은 날짜 내 출발 시간 오름차순
    const sorted = [...logs].sort((a, b) => {
        const dateCmp = resolveDateStr(a).localeCompare(resolveDateStr(b));
        if (dateCmp !== 0) return dateCmp;
        // 날짜 접두어가 붙지 않은 원래 시각으로 견준다 — 접두어가 붙으면 다일 운행이
        // 문자열 비교에서 그 날짜의 맨 뒤로 밀린다.
        return resolveStartTimeRaw(a).localeCompare(resolveStartTimeRaw(b));
    });

    const layout = { orgName, period, approvalLine, includeHipass, includePassengers, includeFuel, includeStartLocation };

    // 페이지 분할 — 행 높이가 내용에 따라 달라지므로 실제로 재서 나눈다 (pageFit.ts)
    const pages = splitPages(sorted, layout);

    const htmlContent = buildPdfHtml(pages, layout);

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

    // 접속기록 — 운행일지는 운전자·공동운전자·탑승자 이름을 담는 최대 반출 경로다.
    recordExport('pdf', 'driveLogs', logs.length);
}

/**
 * 운행일지 데이터 행을 HTML TR로 변환
 */
function buildLogRow(log: PdfLogEntry, rowNo: number, includeHipass = false, includePassengers = false, includeFuel = false, includeStartLocation = false) {
    const date = resolveDateStr(log, '-');
    const distance = resolveDistance(log);

    // 하이패스 정보를 비고에 합침
    let noteText = log.notes || '';
    if (includeHipass && log.hipassCardNumber) {
        // hipassBalanceAfter는 '사용 후 잔액'(직원이 입력), hipassBalanceBefore는 '사용 전 잔액'(카드 잔액).
        // 사용액은 before - after다 — submitDriveLog(usedAmount)·VehicleStatusSection 표시와 같은 규칙.
        // 과거에는 after를 '사용액', before-after를 '남음'으로 인쇄해 두 값이 뒤바뀌어 나갔다.
        const remaining = log.hipassBalanceAfter ?? 0;
        const used = Math.max(0, (log.hipassBalanceBefore ?? 0) - remaining);
        const hipassInfo = `[하이패스] ${used.toLocaleString()}원 사용, ${remaining.toLocaleString()}원 남음`;
        noteText = noteText ? `${noteText} / ${hipassInfo}` : hipassInfo;
    }

    return `
        <tr>
            <td class="center">${rowNo}</td>
            <td class="center">${formatDate(date)}</td>
            <td class="center">${escapeHtml(resolveStartTime(log))}</td>
            <td class="center">${escapeHtml(resolveEndTime(log))}</td>
            <td class="center">${escapeHtml(log.driverName || '')}</td>
            <td class="center">${escapeHtml(log.vehicleDisplayName || log.vehicleName || '')}</td>
            ${includeStartLocation ? `<td>${escapeHtml(log.startLocation || '')}</td>` : ''}
            <td>${escapeHtml(log.destination || '')}</td>
            <td>${escapeHtml(log.purpose || '')}</td>
            <td class="right">${formatNumber(resolveStartKm(log))}</td>
            <td class="right">${formatNumber(resolveEndKm(log))}</td>
            <td class="right">${distance > 0 ? distance.toLocaleString() : ''}</td>
            <td class="center">${escapeHtml(log.passengerCount || '')}</td>
            ${includeFuel ? `<td class="right" style="font-size: 8px;">${escapeHtml(log.fuelSummary || '')}</td>` : ''}
            ${includePassengers ? `<td class="center" style="font-size: 8px;">${escapeHtml(log.passengerNames?.join(', ') || '')}</td>` : ''}
            <td>${escapeHtml(noteText)}</td>
        </tr>
    `;
}

/**
 * 빈 행 HTML (페이지 아래를 채워 양식 높이를 유지한다)
 *
 * 칸이 전부 비어 있으므로 조건부 열을 어느 위치에 넣든 인쇄 결과는 같다 — **개수만** 헤더와
 * 맞으면 된다(열 너비는 헤더의 class가 정한다).
 */
function buildEmptyRows(count: number, includePassengers = false, includeFuel = false, includeStartLocation = false) {
    return Array(count).fill(null).map(() => `
        <tr>
            <td class="center">&nbsp;</td>
            <td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>
            <td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>
            <td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>
            ${includeStartLocation ? '<td>&nbsp;</td>' : ''}
            ${includeFuel ? '<td>&nbsp;</td>' : ''}
            ${includePassengers ? '<td>&nbsp;</td>' : ''}
            <td>&nbsp;</td>
        </tr>
    `).join('');
}

/**
 * 결재란 HTML 생성
 *
 * @param hidden 자리는 그대로 두고 표만 감춘다 — 결재란은 첫 장에만 찍는다(둘째 장부터 반복되면
 *               결재 도장을 어디에 찍어야 하는지 모호해진다). 다만 자리까지 없애면 표가 시작되는
 *               높이가 장마다 달라져 양식이 어긋나므로, 둘째 장부터는 `visibility: hidden`으로 비운다.
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

/**
 * 단일 페이지 HTML 생성
 */
function buildPageHtml(page: PageContent, pageIdx: number, totalPages: number, { orgName, period, approvalLine, includeHipass = false, includePassengers = false, includeFuel = false, includeStartLocation = false, totalAllDistance = 0 }: { orgName: string; period: string; approvalLine: ApprovalEntry[]; includeHipass?: boolean; includePassengers?: boolean; includeFuel?: boolean; includeStartLocation?: boolean; totalAllDistance?: number }) {
    const pageNum = pageIdx + 1;
    const pageTotalDistance = page.rows.reduce((sum, log) => sum + resolveDistance(log), 0);

    const rowsHtml = page.rows.map((log: PdfLogEntry, idx: number) => buildLogRow(log, page.start + idx + 1, includeHipass, includePassengers, includeFuel, includeStartLocation)).join('');
    const emptyRowsHtml = buildEmptyRows(page.emptyCount, includePassengers, includeFuel, includeStartLocation);
    // 소계·합계 라벨이 덮는 칸 수 — 출발지 열이 붙으면 한 칸 늘어난다(안 늘리면 주행거리 합계가 밀린다)
    const totalLabelSpan = 10 + (includeStartLocation ? 1 : 0);
    const approvalHtml = buildApprovalHtml(approvalLine, pageIdx > 0);

    return `
        <div class="page">
            <div class="header-area">
                <h1 class="title">차량운행일지</h1>
                ${approvalHtml}
            </div>
            <div class="info-row">
                <div class="info-left">
                    <span class="info-label">기관명</span>
                    <span class="info-value">${escapeHtml(orgName)}</span>
                </div>
                <div class="info-right">
                    <span class="info-label">기간</span>
                    <span class="info-value">${escapeHtml(period)}</span>
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
                        ${includeStartLocation ? '<th rowspan="2" class="col-dest">출발지</th>' : ''}
                        <th rowspan="2" class="col-dest">목적지</th>
                        <th rowspan="2" class="col-purpose">사용목적</th>
                        <th colspan="3">주행거리 (km)</th>
                        <th rowspan="2" class="col-passenger">탑승<br/>인원</th>
                        ${includeFuel ? '<th rowspan="2" class="col-fuel">주유금액<br/>(주유량)</th>' : ''}
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
                        <td colspan="${totalLabelSpan}" class="center total-label">소 계</td>
                        <td class="right total-value">${pageTotalDistance > 0 ? pageTotalDistance.toLocaleString() : ''}</td>
                        <td></td>
                        ${includeFuel ? '<td></td>' : ''}
                        ${includePassengers ? '<td></td>' : ''}
                        <td></td>
                    </tr>
                    ${pageIdx === totalPages - 1 ? `
                    <tr class="total-row" style="font-weight:bold; background:#e8f0fe;">
                        <td colspan="${totalLabelSpan}" class="center total-label">합 계</td>
                        <td class="right total-value">${totalAllDistance > 0 ? totalAllDistance.toLocaleString() : ''}</td>
                        <td></td>
                        ${includeFuel ? '<td></td>' : ''}
                        ${includePassengers ? '<td></td>' : ''}
                        <td></td>
                    </tr>` : ''}
                </tbody>
            </table>
        </div>
    `;
}

/**
 * 실제 행 높이를 재서 페이지를 나눈다.
 *
 * 목적지 주소가 길면 행이 2~3줄로 자라 고정 행 수 분할이 용지를 넘긴다(pageFit.ts 주석 참고).
 * 전체 행을 한 페이지에 담은 측정용 문서를 숨은 iframe에 그려 행별 높이를 재고, 남은
 * 높이만큼만 담는다. 측정이 불가능한 환경에서는 예전처럼 고정 행 수로 나눈다.
 */
function splitPages(sorted: PdfLogEntry[], layout: { orgName: string; period: string; approvalLine: ApprovalEntry[]; includeHipass?: boolean; includePassengers?: boolean; includeFuel?: boolean; includeStartLocation?: boolean }): PageContent[] {
    // 측정용: 전체 행 + 빈 행 1개(기준 높이) + 소계 + 합계가 한 페이지에 담긴 문서
    const probe = buildPdfHtml([{ rows: sorted, start: 0, emptyCount: 1 }], layout);
    const metrics = measurePageMetrics(probe, sorted.length);
    const slices = metrics ? paginateByHeight(metrics) : [];

    if (slices.length > 0) {
        return slices.map(slice => ({
            rows: sorted.slice(slice.start, slice.start + slice.count),
            start: slice.start,
            emptyCount: slice.emptyCount,
        }));
    }

    const pages: PageContent[] = [];
    for (let i = 0; i < sorted.length; i += FALLBACK_ROWS_PER_PAGE) {
        const rows = sorted.slice(i, i + FALLBACK_ROWS_PER_PAGE);
        pages.push({ rows, start: i, emptyCount: FALLBACK_ROWS_PER_PAGE - rows.length });
    }
    return pages;
}

/**
 * 전체 HTML 문서 생성
 */
function buildPdfHtml(pages: PageContent[], options: { orgName: string; period: string; approvalLine: ApprovalEntry[]; includeHipass?: boolean; includePassengers?: boolean; includeFuel?: boolean; includeStartLocation?: boolean }) {
    const totalPages = pages.length;
    // 전체 페이지에 걸친 총 주행거리 합계
    const totalAllDistance = pages.flatMap(p => p.rows).reduce((sum, log) => sum + resolveDistance(log), 0);
    const pagesHtml = pages.map((page, pageIdx) =>
        buildPageHtml(page, pageIdx, totalPages, { ...options, totalAllDistance })
    ).join('');

    return `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <title>차량운행일지 - ${escapeHtml(options.orgName)}</title>
    <style>${getPdfStyles()}</style>
</head>
<body>
    ${pagesHtml}
</body>
</html>
    `;
}
