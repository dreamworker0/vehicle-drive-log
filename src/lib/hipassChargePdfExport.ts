/**
 * PDF 하이패스 충전 기록 다운로드 유틸리티
 * pdfEngine 공통 엔진 기반
 */
import { printPdfReport, getTimeStr, formatDate, formatNumber } from './pdfEngine';
import type { ApprovalEntry, PdfColumn } from './pdfEngine';

/** PDF용 하이패스 충전 기록 행 */
interface PdfHipassChargeEntry {
    date?: string;
    createdAt?: { toDate?: () => Date } | Date | unknown;
    vehicleName?: string;
    chargerName?: string;
    cardNumber?: string;
    chargeAmount?: number;
    balanceBefore?: number;
    balanceAfter?: number;
}

const COLUMNS: PdfColumn[] = [
    { header: 'No.', className: 'col-no', width: '28px' },
    { header: '날짜', className: 'col-date', width: '72px' },
    { header: '시각', className: 'col-time', width: '42px' },
    { header: '차량', className: 'col-vehicle', width: '82px' },
    { header: '충전자', className: 'col-charger', width: '60px' },
    { header: '하이패스 카드', className: 'col-card', width: '100px' },
    { header: '충전금액(원)', className: 'col-amount', width: '80px' },
    { header: '충전전잔액', className: 'col-before', width: '80px' },
    { header: '충전후잔액', className: 'col-after', width: '80px' },
];

const ROWS_PER_PAGE = 25;

function renderRow(rec: PdfHipassChargeEntry, idx: number, pageIdx: number, rowsPerPage: number): string {
    return `
        <tr>
            <td class="center">${idx + 1 + (pageIdx * rowsPerPage)}</td>
            <td class="center">${formatDate(rec.date || '')}</td>
            <td class="center">${getTimeStr(rec.createdAt)}</td>
            <td class="center">${rec.vehicleName || ''}</td>
            <td class="center">${rec.chargerName || ''}</td>
            <td class="center">${rec.cardNumber || ''}</td>
            <td class="right">${formatNumber(rec.chargeAmount)}</td>
            <td class="right">${formatNumber(rec.balanceBefore)}</td>
            <td class="right">${formatNumber(rec.balanceAfter)}</td>
        </tr>
    `;
}

function renderTotalRow(pageRows: PdfHipassChargeEntry[]): string {
    const totalCharge = pageRows.reduce((sum, r) => sum + (r.chargeAmount || 0), 0);
    return `
        <tr class="total-row">
            <td colspan="6" class="center total-label">소 계</td>
            <td class="right total-value">${totalCharge > 0 ? totalCharge.toLocaleString() : ''}</td>
            <td>&nbsp;</td>
            <td>&nbsp;</td>
        </tr>
    `;
}

/**
 * 하이패스 충전 기록 데이터를 PDF로 내보내기 (브라우저 인쇄 → PDF 저장)
 */
export function downloadHipassChargePdf(
    records: PdfHipassChargeEntry[],
    options: {
        onError?: (msg: string) => void;
        orgName?: string;
        approvalLine?: ApprovalEntry[];
    } = {},
) {
    return printPdfReport<PdfHipassChargeEntry>({
        title: '하 이 패 스 충 전 기 록',
        orgName: options.orgName || '',
        records,
        columns: COLUMNS,
        renderRow,
        renderTotalRow,
        rowsPerPage: ROWS_PER_PAGE,
        approvalLine: options.approvalLine || [],
        onError: options.onError,
        extraStyles: '.title { font-size: 20px; }', // 긴 제목 대응
    });
}
