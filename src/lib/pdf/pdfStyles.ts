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

        /* 둘째 장 이후: 결재란은 감추고 자리(표 시작 높이)만 유지한다 */
        .approval-table.approval-hidden {
            visibility: hidden;
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
        /*
         * 이틀 이상 걸린 운행은 '9/1 17:00'처럼 날짜가 앞에 붙는데, 표 전체가
         * word-break: break-all이라 '9/1 1' / '7:00'처럼 토큰 한가운데가 잘린다.
         * 줄바꿈이 공백에서만 일어나게 해 '9/1' / '17:00' 두 줄로 떨어뜨린다.
         *
         * (위 .col-time의 34px은 이 열에 실제로 걸리지 않는다 — table-layout: fixed에서 폭은
         *  colgroup이나 첫 행이 정하는데, 첫 행은 두 시각 열을 colspan=2로 덮는다. 폭을
         *  손볼 생각이라면 colgroup부터 넣어야 한다.)
         *
         * td.col-time으로 쓰는 이유는 특정도다 — .log-table td(0-1-1)가 .col-time(0-1-0)을
         * 이기므로 클래스만으로는 break-all이 그대로 남는다. 헤더에만 붙어 있던 클래스를
         * 데이터 칸에도 달았다(word-break는 형제에게 상속되지 않는다).
         * 이 파일은 CSS를 템플릿 리터럴로 담으므로 주석에 백틱을 쓰면 문자열이 끊긴다.
         */
        .log-table td.col-time { word-break: keep-all; }
        .col-km { width: 46px; }
        .col-passenger { width: 30px; }
        .col-fuel { width: 64px; }
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
 *
 * **결과는 이미 이스케이프되어 있다 — 호출부에서 다시 감싸지 않는다.**
 *
 * 이 함수는 이름과 달리 '포맷'을 하지 않는다. 두 갈래 모두 입력 문자를 그대로 돌려주는
 * 사실상의 통과 함수다(2026-09-12 감사 발견 2). 그런데 호출부 다섯 곳은 전부 `document.write`로
 * 새 창에 보간하는 HTML 템플릿이고, 그 창은 `window.open('')`이 여는 about:blank라
 * **앱 오리진을 상속한다**. 즉 여기를 지나는 문자열은 곧 앱 오리진의 HTML이다.
 *
 * 날짜 필드는 Rules도 Zod 스키마(`z.string()`)도 형식을 검사하지 않아 기관 구성원이면
 * 임의 문자열을 심을 수 있었고, 같은 행의 이름·목적지·비고가 `escapeHtml`을 지나는 동안
 * 날짜만 그대로 나갔다. 관리자가 PDF를 뽑는 순간 그 문자열이 관리자 세션으로 실행됐다.
 *
 * 호출부를 감싸는 대신 **여기서** 막는 이유는 앞으로 늘어날 호출부 때문이다 — 통과 함수라는
 * 사실이 이름에 드러나지 않아, 다음 사람도 이스케이프된 값이라고 믿고 쓴다.
 * (`formatDateKorean`은 호출부가 이미 감싸고 있어 그대로 둔다.)
 *
 * @param {string} dateStr
 * @returns {string} HTML에 그대로 넣어도 안전한 문자열
 */
export function formatDate(dateStr: string) {
    if (!dateStr || dateStr === '-') return '-';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        return escapeHtml(`${parts[0]}-${parts[1]}-${parts[2]}`);
    }
    return escapeHtml(dateStr);
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
