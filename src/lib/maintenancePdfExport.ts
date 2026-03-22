/**
 * PDF 정비 기록 다운로드 유틸리티
 * pdfEngine 공통 엔진 기반
 */
import { printPdfReport, formatDate, formatNumber } from './pdfEngine';
import type { ApprovalEntry, PdfColumn } from './pdfEngine';

/** PDF용 정비 기록 행 */
interface PdfMaintenanceEntry {
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
}

const COLUMNS: PdfColumn[] = [
    { header: 'No.', className: 'col-no', width: '26px' },
    { header: '날짜', className: 'col-date', width: '72px' },
    { header: '차량', className: 'col-vehicle', width: '80px' },
    { header: '정비유형', className: 'col-type', width: '64px' },
    { header: '비용(원)', className: 'col-cost', width: '68px' },
    { header: '정비소', className: 'col-shop', width: 'auto' },
    { header: '현재km', className: 'col-km', width: '56px' },
    { header: '다음km', className: 'col-nextkm', width: '56px' },
    { header: '다음정비일', className: 'col-nextdate', width: '72px' },
    { header: '메모', className: 'col-memo', width: 'auto' },
    { header: '차단', className: 'col-block', width: '32px' },
];

const ROWS_PER_PAGE = 22;

function createRenderRow(typeLabels: Record<string, string>) {
    return (rec: PdfMaintenanceEntry, idx: number, pageIdx: number, rowsPerPage: number): string => {
        const typeLabel = typeLabels[rec.type || ''] || rec.type || '';
        return `
            <tr>
                <td class="center">${idx + 1 + (pageIdx * rowsPerPage)}</td>
                <td class="center">${formatDate(rec.date || '')}</td>
                <td class="center">${rec.vehicleName || ''}</td>
                <td class="center">${typeLabel}</td>
                <td class="right">${rec.cost ? rec.cost.toLocaleString() : ''}</td>
                <td>${rec.shop || ''}</td>
                <td class="right">${formatNumber(rec.km)}</td>
                <td class="right">${formatNumber(rec.nextDueKm)}</td>
                <td class="center">${rec.nextDueDate ? formatDate(rec.nextDueDate) : ''}</td>
                <td>${rec.description || ''}</td>
                <td class="center">${rec.blockVehicle ? '●' : ''}</td>
            </tr>
        `;
    };
}

function renderTotalRow(pageRows: PdfMaintenanceEntry[]): string {
    const totalCost = pageRows.reduce((sum, r) => sum + (r.cost || 0), 0);
    return `
        <tr class="total-row">
            <td colspan="4" class="center total-label">소 계</td>
            <td class="right total-value">${totalCost > 0 ? totalCost.toLocaleString() : ''}</td>
            <td colspan="6"></td>
        </tr>
    `;
}

/**
 * 정비 기록 데이터를 PDF로 내보내기 (브라우저 인쇄 → PDF 저장)
 */
export function downloadMaintenancePdf(
    records: PdfMaintenanceEntry[],
    options: {
        onError?: (msg: string) => void;
        orgName?: string;
        typeLabels?: Record<string, string>;
        approvalLine?: ApprovalEntry[];
    } = {},
) {
    return printPdfReport<PdfMaintenanceEntry>({
        title: '차량 정비 기록',
        orgName: options.orgName || '',
        records,
        columns: COLUMNS,
        renderRow: createRenderRow(options.typeLabels || {}),
        renderTotalRow,
        rowsPerPage: ROWS_PER_PAGE,
        approvalLine: options.approvalLine || [],
        onError: options.onError,
        extraStyles: `
            .log-table { font-size: 9.5px; }
            .log-table th { font-size: 9.5px; height: 26px; }
            .log-table tbody td { font-size: 9px; }
            .log-table th, .log-table td { padding: 3px 4px; }
        `,
    });
}
