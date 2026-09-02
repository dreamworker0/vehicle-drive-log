/**
 * PDF 공통 엔진
 * fuelLogPdfExport, hipassChargePdfExport, maintenancePdfExport 의 공통 로직을 통합.
 * 각 모듈은 컬럼 정의 + 행 변환 로직만 제공하고, 이 엔진이 HTML 조립·페이지 분할·인쇄를 처리.
 */
import { formatDate, formatNumber, escapeHtml } from './pdfStyles';
import { measurePageMetrics, paginateByHeight } from './pageFit';
import { recordExport, type ExportDataset } from '../audit/recordExport';

// ── 공통 타입 ──

/** 결재라인 항목 */
export interface ApprovalEntry {
    title: string;
}

/** 컬럼 정의: 헤더 텍스트, CSS 클래스명, 너비 */
export interface PdfColumn {
    header: string;
    className: string;
    width: string;
}

/** PDF 보고서 설정 */
interface PdfReportConfig<T> {
    title: string;
    orgName: string;
    records: T[];
    columns: PdfColumn[];
    /**
     * 각 레코드를 테이블 행(<td> 배열)으로 변환.
     *
     * `rowNumber`는 **페이지를 넘어 이어지는 1-based 일련번호**다. 실측 분할로 페이지당 행 수가
     * 페이지마다 달라지므로 `pageIdx * rowsPerPage`로는 계산할 수 없어 엔진이 계산해 넘긴다.
     */
    renderRow: (record: T, rowNumber: number) => string;
    /** 페이지 소계 행 (선택사항) — 모든 페이지에 붙는다 */
    renderTotalRow?: (pageRows: T[]) => string;
    /** 정렬 비교 함수 (기본: date 최신순) */
    sorter?: (a: T, b: T) => number;
    /** 실측이 불가능한 환경(jsdom 등)에서 되돌아갈 고정 행 수 */
    rowsPerPage?: number;
    approvalLine?: ApprovalEntry[];
    onError?: (msg: string) => void;
    /** 추가 컬럼 CSS (colStyles에 커스텀 CSS 추가 가능) */
    extraStyles?: string;
    /**
     * 접속기록에 남길 반출 대상(고시 제16조).
     * 엔진은 어떤 리포트인지 모르므로 호출부가 알려준다.
     */
    auditDataset: ExportDataset;
}

/** 한 페이지에 담을 내용 — 실측 분할(pageFit)이나 고정 행 수 되돌림이 정한다 */
interface ReportPage<T> {
    rows: T[];
    /** 전체 정렬 배열에서의 시작 인덱스 — 일련번호가 페이지를 넘어 이어지게 한다 */
    start: number;
    /** 아래를 채울 빈 행 수 — 양식 높이를 유지한다 */
    emptyCount: number;
}

// ── 공통 유틸 ──

export { formatDate, formatNumber, escapeHtml };

/** Firestore timestamp → 시각 문자열 */
export function getTimeStr(createdAt: unknown): string {
    if (!createdAt) return '';
    const d = createdAt instanceof Date ? createdAt
        : (createdAt as { toDate?: () => Date }).toDate?.() || null;
    if (!d) return '';
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// ── 공통 HTML 빌더 ──

/**
 * 결재란 HTML 생성
 *
 * @param hidden 자리는 그대로 두고 표만 감춘다 — 결재란은 첫 장에만 찍는다(둘째 장부터 반복되면
 *               결재 도장을 어디에 찍어야 하는지 모호해진다). 다만 자리까지 없애면 표가 시작되는
 *               높이가 장마다 달라져 양식이 어긋나므로, 둘째 장부터는 `visibility: hidden`으로 비운다.
 */
export function buildApprovalHtml(approvalLine: ApprovalEntry[], hidden = false): string {
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

/** 빈 행 HTML 생성 */
export function buildEmptyRows(colCount: number, rowCount: number): string {
    const cells = Array(colCount).fill('<td>&nbsp;</td>').join('');
    return Array(rowCount).fill(`<tr>${cells}</tr>`).join('\n');
}

/** A4 가로형 공통 CSS */
function getLandscapePdfStyles(columnStyles: string, extraStyles = ''): string {
    return `
        @page { size: A4 landscape; margin: 12mm 10mm; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Malgun Gothic', '맑은 고딕', 'Noto Sans KR', sans-serif;
            font-size: 10px; color: #111; background: #fff;
        }
        .page { page-break-after: always; width: 100%; }
        .page:last-child { page-break-after: auto; }
        .header-area {
            display: flex; align-items: flex-start;
            justify-content: space-between; margin-bottom: 10px;
        }
        .title {
            font-size: 22px; font-weight: 800;
            letter-spacing: 6px; padding-top: 8px;
        }
        .info-row {
            display: flex; justify-content: space-between;
            align-items: center; margin-bottom: 6px; font-size: 11px;
        }
        .info-label { font-weight: 700; margin-right: 6px; }
        .info-value { margin-right: 20px; }
        .page-num { font-size: 10px; color: #666; }
        .log-table {
            width: 100%; border-collapse: collapse;
            font-size: 10px; table-layout: fixed;
        }
        .log-table th, .log-table td {
            border: 1px solid #333; padding: 4px 6px;
            vertical-align: middle; word-break: break-all;
        }
        .log-table thead th {
            background: #e8e8e8; font-weight: 700;
            text-align: center; font-size: 10px;
            height: 28px; white-space: nowrap;
        }
        .log-table tbody td { height: 22px; font-size: 9.5px; }
        .center { text-align: center; }
        .right { text-align: right; }
        .left { text-align: left; }
        .approval-table { border-collapse: collapse; float: right; margin-top: 4px; }
        .approval-table td, .approval-table th {
            border: 1px solid #333; text-align: center;
            font-size: 9px; padding: 2px 6px;
        }
        .approval-header {
            background: #e8e8e8; font-weight: 700; font-size: 9px;
            width: 22px; padding: 2px 4px; line-height: 1.4;
        }
        .approval-title {
            background: #f5f5f5; font-weight: 600; font-size: 9px;
            min-width: 52px; height: 18px;
        }
        .approval-sign { height: 40px; min-width: 52px; }
        /* 둘째 장 이후: 결재란은 감추고 자리(표 시작 높이)만 유지한다 */
        .approval-table.approval-hidden { visibility: hidden; }
        .total-row { background: #f5f5f5; font-weight: 700; }
        .total-label { font-size: 10px; }
        .total-value { font-size: 10px; }
        @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
        @media screen {
            body { padding: 20px; background: #eee; }
            .page {
                background: #fff; padding: 20px 24px; margin-bottom: 20px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.15);
                max-width: 1100px; margin-left: auto; margin-right: auto;
            }
        }
        ${columnStyles}
        ${extraStyles}
    `;
}

// ── 메인 함수 ──

/**
 * PDF 보고서를 브라우저 인쇄로 내보내기
 * 데이터 정렬 → 페이지 분할 → HTML 조립 → window.open → print
 */
export function printPdfReport<T>(config: PdfReportConfig<T>): boolean {
    const {
        title, orgName, records, columns,
        renderRow, renderTotalRow, sorter,
        rowsPerPage = 25, approvalLine = [],
        onError, extraStyles = '', auditDataset,
    } = config;

    if (!records || records.length === 0) {
        onError?.('다운로드할 데이터가 없습니다.');
        return false;
    }

    // 정렬
    const defaultSorter = (a: T, b: T) => {
        const dateA = (a as Record<string, unknown>).date as string || '';
        const dateB = (b as Record<string, unknown>).date as string || '';
        return dateB.localeCompare(dateA);
    };
    const sorted = [...records].sort(sorter || defaultSorter);

    // 컬럼 CSS
    const colStyles = columns.map(c => `.${c.className} { width: ${c.width}; }`).join('\n');
    const styles = getLandscapePdfStyles(colStyles, extraStyles);

    /** 한 페이지 HTML — 측정용 문서와 실제 인쇄물이 **같은 마크업**을 써야 실측이 의미를 갖는다 */
    const buildPage = (page: ReportPage<T>, pageIdx: number, totalPages: number) => `
            <div class="page">
                <div class="header-area">
                    <h1 class="title">${escapeHtml(title)}</h1>
                    ${buildApprovalHtml(approvalLine, pageIdx > 0)}
                </div>
                <div class="info-row">
                    <div class="info-left">
                        <span class="info-label">기관명</span>
                        <span class="info-value">${escapeHtml(orgName)}</span>
                    </div>
                    <div class="info-right">
                        <span class="page-num">(${pageIdx + 1} / ${totalPages})</span>
                    </div>
                </div>
                <table class="log-table">
                    <thead>
                        <tr>${columns.map(c => `<th class="${c.className}">${c.header}</th>`).join('')}</tr>
                    </thead>
                    <tbody>
                        ${page.rows.map((rec, idx) => renderRow(rec, page.start + idx + 1)).join('')}
                        ${buildEmptyRows(columns.length, page.emptyCount)}
                        ${renderTotalRow ? renderTotalRow(page.rows) : ''}
                    </tbody>
                </table>
            </div>
        `;

    const buildDoc = (pages: ReportPage<T>[]) => `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <title>${escapeHtml(title)} - ${escapeHtml(orgName)}</title>
    <style>${styles}</style>
</head>
<body>${pages.map((page, pageIdx) => buildPage(page, pageIdx, pages.length)).join('')}</body>
</html>`;

    /**
     * 페이지 분할 — 고정 행 수는 셀이 줄바꿈되는 표에서 용지를 넘긴다(운행일지에서 21건이 3장으로
     * 나갔던 그 문제). 전체 행을 한 페이지에 담은 측정용 문서를 숨은 iframe에 그려 실제 높이를 재고
     * 남은 높이만큼만 담는다. 측정 불가 환경(jsdom 등)에서는 예전처럼 고정 행 수로 되돌린다.
     */
    const splitPages = (): ReportPage<T>[] => {
        // 측정용: 전체 행 + 빈 행 1개(기준 높이) + 소계가 한 페이지에 담긴 문서
        const probe = buildDoc([{ rows: sorted, start: 0, emptyCount: 1 }]);
        // 이 계열 보고서는 페이지 소계만 있고 마지막 장에만 붙는 총 합계 행이 없다
        const metrics = measurePageMetrics(probe, sorted.length, { trailing: { subtotal: !!renderTotalRow, total: false } });
        const slices = metrics ? paginateByHeight(metrics) : [];

        if (slices.length > 0) {
            return slices.map(slice => ({
                rows: sorted.slice(slice.start, slice.start + slice.count),
                start: slice.start,
                emptyCount: slice.emptyCount,
            }));
        }

        const fallback: ReportPage<T>[] = [];
        for (let i = 0; i < sorted.length; i += rowsPerPage) {
            const rows = sorted.slice(i, i + rowsPerPage);
            fallback.push({ rows, start: i, emptyCount: rowsPerPage - rows.length });
        }
        return fallback;
    };

    const html = buildDoc(splitPages());

    // 새 창에서 인쇄
    const printWindow = window.open('', '_blank', 'width=1100,height=800');
    if (!printWindow) {
        onError?.('팝업이 차단되었습니다. 팝업 허용 후 다시 시도해주세요.');
        return false;
    }

    printWindow.document.write(html);
    printWindow.document.close();

    printWindow.onload = () => {
        setTimeout(() => { printWindow.print(); }, 300);
    };

    // 인쇄 창이 실제로 열린 뒤에만 반출로 기록한다(팝업 차단은 위에서 이미 반환됨).
    recordExport('pdf', auditDataset, records.length);

    return true;
}
