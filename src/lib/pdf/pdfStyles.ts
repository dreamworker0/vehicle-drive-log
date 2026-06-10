/**
 * pdfStyles — PDF 운행일지 HTML 문서용 CSS 스타일
 * buildPdfHtml에서 사용
 */

/**
 * PDF 운행일지 CSS 스타일 문자열 반환
 * @returns {string} CSS
 */
export function getPdfStyles() {
    return `
        @page {
            size: A4 landscape;
            margin: 12mm 10mm;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Malgun Gothic', '맑은 고딕', 'Noto Sans KR', sans-serif;
            font-size: 10px;
            color: #111;
            background: #fff;
        }

        .page {
            page-break-after: always;
            width: 100%;
            padding: 0;
        }

        .page:last-child {
            page-break-after: auto;
        }

        /* 헤더 영역: 제목 */
        .header-area {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            margin-bottom: 10px;
        }

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

        .approval-name {
            font-size: 9px;
            height: 18px;
            min-width: 52px;
        }

        .title {
            font-size: 22px;
            font-weight: 800;
            letter-spacing: 6px;
            padding-top: 8px;
        }

        /* 기관/기간 정보 */
        .info-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 6px;
            font-size: 11px;
        }

        .info-label {
            font-weight: 700;
            margin-right: 6px;
        }

        .info-value {
            margin-right: 20px;
        }

        .page-num {
            font-size: 10px;
            color: #666;
        }

        /* 운행일지 테이블 */
        .log-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 9.5px;
            table-layout: fixed;
        }

        .log-table th,
        .log-table td {
            border: 1px solid #333;
            padding: 3px 4px;
            vertical-align: middle;
            word-break: break-all;
        }

        .log-table thead th {
            background: #e8e8e8;
            font-weight: 700;
            text-align: center;
            font-size: 9.5px;
            height: 26px;
        }

        .log-table tbody td {
            height: 22px;
            font-size: 9px;
        }

        /* 열 너비 */
        .col-no { width: 26px; }
        .col-date { width: 70px; }
        .col-driver { width: 48px; }
        .col-vehicle { width: 76px; }
        .col-dest { width: auto; }
        .col-purpose { width: auto; }
        .col-time { width: 34px; }
        .col-km { width: 46px; }
        .col-passenger { width: 30px; }
        .col-passengers { width: 50px; }
        .col-note { width: 80px; }

        /* 정렬 */
        .center { text-align: center; }
        .right { text-align: right; }

        /* 소계 행 */
        .total-row {
            background: #f5f5f5;
            font-weight: 700;
        }

        .total-label {
            font-size: 10px;
        }

        .total-value {
            font-size: 10px;
        }

        /* 인쇄 전용 */
        @media print {
            body {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }
        }

        /* 화면 미리보기용 */
        @media screen {
            body {
                padding: 20px;
                background: #eee;
            }
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
 * 날짜 포맷 (YYYY-MM-DD)
 * @param {string} dateStr
 * @returns {string}
 */
export function formatDate(dateStr: string) {
    if (!dateStr || dateStr === '-') return '-';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        return `${parts[0]}-${parts[1]}-${parts[2]}`;
    }
    return dateStr;
}

/**
 * 숫자 포맷 (toLocaleString)
 * @param {*} val
 * @returns {string}
 */
export function formatNumber(val: unknown) {
    if (val === undefined || val === null || val === '') return '';
    return Number(val).toLocaleString();
}

/**
 * HTML escape — 사용자 입력(기관명·운전자명·목적지·비고 등)을 document.write로
 * 새 창에 보간하기 전에 반드시 거친다 (XSS 방지)
 * @param {*} value
 * @returns {string}
 */
export function escapeHtml(value: unknown): string {
    if (value === undefined || value === null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
