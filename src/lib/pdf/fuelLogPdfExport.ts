/**
 * PDF 주유 기록 다운로드 유틸리티
 * pdfEngine 공통 엔진 기반
 */
import { printPdfReport, getTimeStr, formatDate, formatNumber } from './pdfEngine';
import type { ApprovalEntry, PdfColumn } from './pdfEngine';

/** PDF용 주유 기록 행 */
interface PdfFuelLogEntry {
    date?: string;
    createdAt?: { toDate?: () => Date } | Date | unknown;
    vehicleName?: string;
    driverName?: string;
    meterReading?: number;
    fuelType?: string;
    fuelAmount?: number;
    fuelCost?: number;
    notes?: string;
}

const COLUMNS: PdfColumn[] = [
    { header: 'No.', className: 'col-no', width: '28px' },
    { header: '날짜', className: 'col-date', width: '72px' },
    { header: '시각', className: 'col-time', width: '42px' },
    { header: '차량', className: 'col-vehicle', width: '82px' },
    { header: '주유/충전원', className: 'col-driver', width: '60px' },
    { header: '주유미터(km)', className: 'col-meter', width: '80px' },
    { header: '주유/충전량', className: 'col-amount', width: '68px' },
    { header: '금액(원)', className: 'col-cost', width: '80px' },
    { header: '비고', className: 'col-notes', width: 'auto' },
];

const ROWS_PER_PAGE = 25;

function renderRow(rec: PdfFuelLogEntry, idx: number, pageIdx: number, rowsPerPage: number): string {
    const unit = ['electric', 'hydrogen'].includes(rec.fuelType || '')
        ? (rec.fuelType === 'hydrogen' ? 'kg' : 'kWh')
        : 'L';
    return `
        <tr>
            <td class="center">${idx + 1 + (pageIdx * rowsPerPage)}</td>
            <td class="center">${formatDate(rec.date || '')}</td>
            <td class="center">${getTimeStr(rec.createdAt)}</td>
            <td class="center">${rec.vehicleName || ''}</td>
            <td class="center">${rec.driverName || ''}</td>
            <td class="right">${formatNumber(rec.meterReading)}</td>
            <td class="right">${rec.fuelAmount ? `${rec.fuelAmount} ${unit}` : ''}</td>
            <td class="right">${rec.fuelCost ? rec.fuelCost.toLocaleString() : ''}</td>
            <td class="left">${rec.notes || ''}</td>
        </tr>
    `;
}

function renderTotalRow(pageRows: PdfFuelLogEntry[]): string {
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
    return printPdfReport<PdfFuelLogEntry>({
        title: '주유 / 충전 기록',
        orgName: options.orgName || '',
        records,
        columns: COLUMNS,
        renderRow,
        renderTotalRow,
        rowsPerPage: ROWS_PER_PAGE,
        approvalLine: options.approvalLine || [],
        onError: options.onError,
    });
}
