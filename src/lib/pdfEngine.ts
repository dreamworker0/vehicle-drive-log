/**
 * PDF 공통 엔진
 * fuelLogPdfExport, hipassChargePdfExport, maintenancePdfExport 의 공통 로직을 통합.
 * 각 모듈은 컬럼 정의 + 행 변환 로직만 제공하고, 이 엔진이 HTML 조립·페이지 분할·인쇄를 처리.
 */
import { formatDate, formatNumber } from './pdfStyles';

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
export interface PdfReportConfig<T> {
    title: string;
    orgName: string;
    records: T[];
    columns: PdfColumn[];
    /** 각 레코드를 테이블 행(<td> 배열)으로 변환 */
    renderRow: (record: T, idx: number, pageIdx: number, rowsPerPage: number) => string;
    /** 소계 행 (선택사항) */
    renderTotalRow?: (pageRows: T[]) => string;
    /** 정렬 비교 함수 (기본: date 최신순) */
    sorter?: (a: T, b: T) => number;
    rowsPerPage?: number;
    approvalLine?: ApprovalEntry[];
    onError?: (msg: string) => void;
    /** 추가 컬럼 CSS (colStyles에 커스텀 CSS 추가 가능) */
    extraStyles?: string;
}

// ── 공통 유틸 ──

export { formatDate, formatNumber };

/** Firestore timestamp → 시각 문자열 */
export function getTimeStr(createdAt: unknown): string {
    if (!createdAt) return '';
    const d = createdAt instanceof Date ? createdAt
        : (createdAt as { toDate?: () => Date }).toDate?.() || null;
    if (!d) return '';
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// ── 공통 HTML 빌더 ──

/** 결재란 HTML 생성 */
export function buildApprovalHtml(approvalLine: ApprovalEntry[]): string {
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

/** 빈 행 HTML 생성 */
export function buildEmptyRows(colCount: number, rowCount: number): string {
    const cells = Array(colCount).fill('<td>&nbsp;</td>').join('');
    return Array(rowCount).fill(`<tr>${cells}</tr>`).join('\n');
}

/** A4 가로형 공통 CSS */
export function getLandscapePdfStyles(columnStyles: string, extraStyles = ''): string {
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
        onError, extraStyles = '',
    } = config;

    if (!records || records.length === 0) {
        onError?.('다운로드할 데이터가 없습니다.');
        return false;
    }

    // 정렬
    const defaultSorter = (a: T, b: T) => {
        const dateA = (a as Record<string, any>).date || '';
        const dateB = (b as Record<string, any>).date || '';
        return dateB.localeCompare(dateA);
    };
    const sorted = [...records].sort(sorter || defaultSorter);

    // 페이지 분할
    const pages: T[][] = [];
    for (let i = 0; i < sorted.length; i += rowsPerPage) {
        pages.push(sorted.slice(i, i + rowsPerPage));
    }

    // 컬럼 CSS
    const colStyles = columns.map(c => `.${c.className} { width: ${c.width}; }`).join('\n');
    const styles = getLandscapePdfStyles(colStyles, extraStyles);

    // 페이지 HTML
    const totalPages = pages.length;
    const pagesHtml = pages.map((pageRows, pageIdx) => {
        const rowsHtml = pageRows.map((rec, idx) => renderRow(rec, idx, pageIdx, rowsPerPage)).join('');
        const emptyHtml = buildEmptyRows(columns.length, rowsPerPage - pageRows.length);
        const totalHtml = renderTotalRow ? renderTotalRow(pageRows) : '';

        return `
            <div class="page">
                <div class="header-area">
                    <h1 class="title">${title}</h1>
                    ${buildApprovalHtml(approvalLine)}
                </div>
                <div class="info-row">
                    <div class="info-left">
                        <span class="info-label">기관명</span>
                        <span class="info-value">${orgName}</span>
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
                        ${rowsHtml}
                        ${emptyHtml}
                        ${totalHtml}
                    </tbody>
                </table>
            </div>
        `;
    }).join('');

    // 전체 HTML 문서
    const html = `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <title>${title} - ${orgName}</title>
    <style>${styles}</style>
</head>
<body>${pagesHtml}</body>
</html>`;

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

    return true;
}
