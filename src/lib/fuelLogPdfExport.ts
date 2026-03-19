/**
 * PDF 주유 기록 다운로드 유틸리티
 * 브라우저 인쇄 기능으로 PDF 생성 — A4 가로형
 */
import { formatDate, formatNumber } from './pdfStyles';

/** PDF용 주유 기록 행 */
interface PdfFuelLogEntry {
    date?: string;
    createdAt?: { toDate?: () => Date } | Date | unknown;
    vehicleName?: string;
    driverName?: string;
    meterReading?: number;
    fuelAmount?: number;
    fuelCost?: number;
    notes?: string;
}

/** 결재라인 항목 */
interface ApprovalEntry {
    title: string;
}

// 페이지당 행 수
const ROWS_PER_PAGE = 25;

/**
 * 주유 기록 데이터를 PDF로 내보내기 (브라우저 인쇄 → PDF 저장)
 */
export function downloadFuelLogPdf(
    records: PdfFuelLogEntry[],
    options: {
        onError?: (msg: string) => void;
        orgName?: string;
        approvalLine?: ApprovalEntry[];
    } = {},
) {
    if (!records || records.length === 0) {
        options.onError?.('다운로드할 데이터가 없습니다.');
        return false;
    }

    const { orgName = '', approvalLine = [] } = options;

    // 날짜순 정렬 (최신순)
    const sorted = [...records].sort((a, b) => {
        const dateA = a.date || '';
        const dateB = b.date || '';
        return dateB.localeCompare(dateA);
    });

    // 페이지 분할
    const pages: PdfFuelLogEntry[][] = [];
    for (let i = 0; i < sorted.length; i += ROWS_PER_PAGE) {
        pages.push(sorted.slice(i, i + ROWS_PER_PAGE));
    }

    const htmlContent = buildPdfHtml(pages, { orgName, approvalLine });

    // 새 창에서 인쇄
    const printWindow = window.open('', '_blank', 'width=1100,height=800');
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

/**
 * 주유 기록 행을 HTML TR로 변환
 */
function getTimeStr(entry: PdfFuelLogEntry): string {
    if (!entry.createdAt) return '';
    const d = entry.createdAt instanceof Date ? entry.createdAt
        : (entry.createdAt as { toDate?: () => Date }).toDate?.() || null;
    if (!d) return '';
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function buildRow(rec: PdfFuelLogEntry, idx: number, pageIdx: number) {
    return `
        <tr>
            <td class="center">${idx + 1 + (pageIdx * ROWS_PER_PAGE)}</td>
            <td class="center">${formatDate(rec.date || '')}</td>
            <td class="center">${getTimeStr(rec)}</td>
            <td class="center">${rec.vehicleName || ''}</td>
            <td class="center">${rec.driverName || ''}</td>
            <td class="right">${formatNumber(rec.meterReading)}</td>
            <td class="right">${rec.fuelAmount || ''}</td>
            <td class="right">${rec.fuelCost ? rec.fuelCost.toLocaleString() : ''}</td>
            <td class="left">${rec.notes || ''}</td>
        </tr>
    `;
}

/**
 * 빈 행 HTML
 */
function buildEmptyRows(count: number) {
    return Array(count).fill(null).map(() => `
        <tr>
            <td class="center">&nbsp;</td>
            <td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>
            <td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>
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
 * 합계 행
 */
function buildTotalRow(pageRows: PdfFuelLogEntry[]) {
    const totalAmount = pageRows.reduce((sum, r) => sum + (r.fuelAmount || 0), 0);
    const totalCost = pageRows.reduce((sum, r) => sum + (r.fuelCost || 0), 0);
    return `
        <tr class="total-row">
            <td colspan="6" class="center total-label">소 계</td>
            <td class="right total-value">${totalAmount > 0 ? totalAmount.toLocaleString() : ''}</td>
            <td class="right total-value">${totalCost > 0 ? totalCost.toLocaleString() : ''}</td>
            <td>&nbsp;</td>
        </tr>
    `;
}

/**
 * 단일 페이지 HTML 생성
 */
function buildPageHtml(
    pageRows: PdfFuelLogEntry[],
    pageIdx: number,
    totalPages: number,
    { orgName, approvalLine }: { orgName: string; approvalLine: ApprovalEntry[] },
) {
    const pageNum = pageIdx + 1;
    const rowsHtml = pageRows.map((rec, idx) => buildRow(rec, idx, pageIdx)).join('');
    const emptyRowsHtml = buildEmptyRows(ROWS_PER_PAGE - pageRows.length);
    const totalRowHtml = buildTotalRow(pageRows);
    const approvalHtml = buildApprovalHtml(approvalLine);

    return `
        <div class="page">
            <div class="header-area">
                <h1 class="title">주 유 기 록</h1>
                ${approvalHtml}
            </div>
            <div class="info-row">
                <div class="info-left">
                    <span class="info-label">기관명</span>
                    <span class="info-value">${orgName}</span>
                </div>
                <div class="info-right">
                    <span class="page-num">(${pageNum} / ${totalPages})</span>
                </div>
            </div>
            <table class="log-table">
                <thead>
                    <tr>
                        <th class="col-no">No.</th>
                        <th class="col-date">날짜</th>
                        <th class="col-time">시각</th>
                        <th class="col-vehicle">차량</th>
                        <th class="col-driver">주유원</th>
                        <th class="col-meter">주유미터(km)</th>
                        <th class="col-amount">주유량(L)</th>
                        <th class="col-cost">주유금액(원)</th>
                        <th class="col-notes">비고</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                    ${emptyRowsHtml}
                    ${totalRowHtml}
                </tbody>
            </table>
        </div>
    `;
}

/**
 * CSS 스타일 — A4 가로형 (landscape)
 */
function getFuelLogPdfStyles() {
    return `
        @page {
            size: A4 landscape;
            margin: 12mm 10mm;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: 'Malgun Gothic', '맑은 고딕', 'Noto Sans KR', sans-serif;
            font-size: 10px;
            color: #111;
            background: #fff;
        }

        .page { page-break-after: always; width: 100%; }
        .page:last-child { page-break-after: auto; }

        .header-area {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            margin-bottom: 10px;
        }

        .title {
            font-size: 22px;
            font-weight: 800;
            letter-spacing: 8px;
            padding-top: 8px;
        }

        .info-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 6px;
            font-size: 11px;
        }

        .info-label { font-weight: 700; margin-right: 6px; }
        .info-value { margin-right: 20px; }
        .page-num { font-size: 10px; color: #666; }

        .log-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 10px;
            table-layout: fixed;
        }

        .log-table th, .log-table td {
            border: 1px solid #333;
            padding: 4px 6px;
            vertical-align: middle;
            word-break: break-all;
        }

        .log-table thead th {
            background: #e8e8e8;
            font-weight: 700;
            text-align: center;
            font-size: 10px;
            height: 28px;
            white-space: nowrap;
        }

        .log-table tbody td {
            height: 22px;
            font-size: 9.5px;
        }

        .col-no { width: 28px; }
        .col-date { width: 72px; }
        .col-time { width: 42px; }
        .col-vehicle { width: 82px; }
        .col-driver { width: 60px; }
        .col-meter { width: 80px; }
        .col-amount { width: 60px; }
        .col-cost { width: 80px; }
        .col-notes { width: auto; }

        .center { text-align: center; }
        .right { text-align: right; }
        .left { text-align: left; }

        /* 결재 테이블 */
        .approval-table {
            border-collapse: collapse;
            float: right;
            margin-top: 4px;
        }

        .approval-table td,
        .approval-table th {
            border: 1px solid #333;
            text-align: center;
            font-size: 9px;
            padding: 2px 6px;
        }

        .approval-header {
            background: #e8e8e8;
            font-weight: 700;
            font-size: 9px;
            width: 22px;
            padding: 2px 4px;
            line-height: 1.4;
        }

        .approval-title {
            background: #f5f5f5;
            font-weight: 600;
            font-size: 9px;
            min-width: 52px;
            height: 18px;
        }

        .approval-sign {
            height: 40px;
            min-width: 52px;
        }

        .total-row { background: #f5f5f5; font-weight: 700; }
        .total-label { font-size: 10px; }
        .total-value { font-size: 10px; }

        @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }

        @media screen {
            body { padding: 20px; background: #eee; }
            .page {
                background: #fff;
                padding: 20px 24px;
                margin-bottom: 20px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.15);
                max-width: 1100px;
                margin-left: auto;
                margin-right: auto;
            }
        }
    `;
}

/**
 * 전체 HTML 문서 생성
 */
function buildPdfHtml(pages: PdfFuelLogEntry[][], options: { orgName: string; approvalLine: ApprovalEntry[] }) {
    const totalPages = pages.length;
    const pagesHtml = pages.map((pageRows, pageIdx) =>
        buildPageHtml(pageRows, pageIdx, totalPages, options)
    ).join('');

    return `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <title>주유 기록 - ${options.orgName}</title>
    <style>${getFuelLogPdfStyles()}</style>
</head>
<body>
    ${pagesHtml}
</body>
</html>
    `;
}
