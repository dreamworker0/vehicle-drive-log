---
name: add-pdf-export
description: 새 PDF 내보내기 모듈을 추가할 때 기존 패턴을 따르는 가이드
---

# PDF 내보내기 모듈 추가 스킬

## 기존 PDF 모듈 현황

```
src/lib/
├── pdfStyles.ts                ← 공통 CSS 스타일 + 유틸 (formatDate, formatNumber)
├── pdfExport.ts                ← 운행일지 PDF (원본, getPdfStyles 사용)
├── dailyLogPdfExport.ts        ← 일일 운행일지 PDF
├── fuelLogPdfExport.ts         ← 주유 기록 PDF
├── hipassChargePdfExport.ts    ← 하이패스 충전 PDF
└── maintenancePdfExport.ts     ← 정비 기록 PDF
```

## 공통 패턴

모든 PDF 모듈은 동일한 구조를 따른다:

### 1. 파일 구조

```ts
/**
 * PDF {문서명} 다운로드 유틸리티
 * 브라우저 인쇄 기능으로 PDF 생성 — A4 가로형
 */
import { formatDate, formatNumber } from './pdfStyles';

/** PDF용 데이터 행 인터페이스 */
interface PdfEntry { ... }

/** 결재라인 항목 */
interface ApprovalEntry { title: string; }

// 페이지당 행 수
const ROWS_PER_PAGE = 25;  // 모듈별 상이 (19~25)

// 1. 메인 export 함수 — download{Name}Pdf()
// 2. 행 HTML 빌더 — buildRow()
// 3. 빈 행 빌더 — buildEmptyRows()
// 4. 결재란 빌더 — buildApprovalHtml()
// 5. 합계 행 빌더 — buildTotalRow()
// 6. 페이지 HTML 빌더 — buildPageHtml()
// 7. CSS 스타일 — get{Name}PdfStyles()
// 8. 전체 HTML 문서 — buildPdfHtml()
```

### 2. 메인 export 함수 패턴

```ts
export function downloadNewPdf(
    records: PdfEntry[],
    options: {
        onError?: (msg: string) => void;
        orgName?: string;
        approvalLine?: ApprovalEntry[];
    } = {},
) {
    // 1. 빈 데이터 체크
    if (!records || records.length === 0) {
        options.onError?.('다운로드할 데이터가 없습니다.');
        return false;
    }

    // 2. 정렬
    const sorted = [...records].sort((a, b) => { ... });

    // 3. 페이지 분할
    const pages: PdfEntry[][] = [];
    for (let i = 0; i < sorted.length; i += ROWS_PER_PAGE) {
        pages.push(sorted.slice(i, i + ROWS_PER_PAGE));
    }

    // 4. HTML 생성
    const htmlContent = buildPdfHtml(pages, { orgName, approvalLine });

    // 5. 팝업 인쇄
    const printWindow = window.open('', '_blank', 'width=1100,height=800');
    if (!printWindow) {
        options.onError?.('팝업이 차단되었습니다. 팝업 허용 후 다시 시도해주세요.');
        return false;
    }

    printWindow.document.write(htmlContent);
    printWindow.document.close();

    printWindow.onload = () => {
        setTimeout(() => { printWindow.print(); }, 300);
    };
}
```

### 3. CSS 스타일 규칙

- **공통 스타일 재사용**: `pdfStyles.ts`의 `getPdfStyles()`를 import하여 사용하거나, 동일 패턴으로 자체 CSS 함수 정의
- **페이지 설정**: `@page { size: A4 landscape; margin: 12mm 10mm; }`
- **폰트**: `Malgun Gothic, 맑은 고딕, Noto Sans KR, sans-serif`
- **테이블**: `border-collapse: collapse`, `.log-table` 클래스
- **열 너비**: `.col-*` 클래스로 `table-layout: fixed` + 각 열 폭 지정
- **인쇄 대응**: `@media print`, `@media screen` 분리

### 4. 결재란 HTML

모든 PDF 모듈에서 동일한 결재란 구조 사용:

```ts
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
```

## 새 PDF 모듈 추가 절차

1. **파일 생성**: `src/lib/{name}PdfExport.ts`
2. **인터페이스 정의**: `PdfEntry` 타입에 해당 데이터의 필드를 정의
3. **공통 유틸 import**: `import { formatDate, formatNumber } from './pdfStyles'`
4. **위 패턴 그대로 구현** (행 빌더, 빈 행, 결재란, 합계, 페이지, CSS, HTML)
5. **컴포넌트에서 호출**: 해당 페이지에서 PDF 다운로드 버튼에 연결

## 주의사항

1. **팝업 차단 처리**: `window.open` 실패 시 사용자에게 `onError` 콜백으로 안내
2. **빈 데이터 체크**: records가 없거나 빈 배열이면 즉시 return
3. **ROWS_PER_PAGE**: A4 가로형 기준 19~25행이 적절 (열 수가 많으면 줄여야 함)
4. **정렬**: 날짜순 정렬을 기본으로 하되, 문서 특성에 맞게 조정
5. **빈 행 패딩**: 마지막 페이지는 `ROWS_PER_PAGE`에 맞춰 빈 행으로 채움
