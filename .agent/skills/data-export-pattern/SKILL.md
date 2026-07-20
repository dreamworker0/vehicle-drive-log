---
name: data-export-pattern
description: PDF(인쇄 레이아웃) 및 Excel(xlsx 동적 로딩) 파일 내보내기 구현 및 갱신 패턴 가이드
---

# 📊 데이터 내보내기 패턴 (PDF & Excel Export)

이 가이드는 차량운행일지 앱에서 표 형태의 통계/기록 데이터를 PDF(브라우저 인쇄 형태) 및 Excel(xlsx) 형식으로 파일 다운로드하는 통합 개발 스킬 패턴을 설명합니다.

---

## 1. PDF 내보내기 패턴 (A4 가로 인쇄형)

브라우저의 인쇄 기능(`window.print()`)을 활용해 A4 가로(Landscape)에 딱 맞춰 테이블을 인쇄/저장하는 HTML/CSS 기반 PDF 생성 패턴을 따릅니다.

### 1.1 디렉토리 및 모듈 구성
*   `src/lib/pdfStyles.ts`: 공통 폰트 설정, CSS 및 데이터 포맷팅 유틸 (`formatDate`, `formatNumber`)
*   `src/lib/{Domain}PdfExport.ts`: 도메인별 전용 PDF 파일 (예: `dailyLogPdfExport.ts`, `maintenancePdfExport.ts` 등)

### 1.2 주요 구현 패턴 및 함수 구조
1.  **용지 사양**: A4 가로 크기 기준 1페이지에 출력할 테이블 행 수(`ROWS_PER_PAGE`)를 설정합니다. (보통 19 ~ 25행 권장)
2.  **결재란 공통 구현**: 모든 출력물 우측 상단에 결재란 테이블을 자동 삽입합니다.
3.  **데이터 패딩**: 데이터가 부족한 마지막 페이지는 레이아웃 깨짐을 방지하기 위해 빈 행(`&nbsp;`)으로 채웁니다.

```typescript
// 1. 데이터 인터페이스 정의
interface PdfEntry {
    date: string;
    vehicleName: string;
    purpose: string;
    distance: number;
}

// 2. 메인 다운로드 함수
export function downloadVehiclePdf(
    records: PdfEntry[],
    options: { orgName?: string; approvalLine?: { title: string }[] } = {}
) {
    if (!records || records.length === 0) return;
    
    // 데이터 정렬 & 페이지 분할
    const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
    const pages: PdfEntry[][] = [];
    for (let i = 0; i < sorted.length; i += ROWS_PER_PAGE) {
        pages.push(sorted.slice(i, i + ROWS_PER_PAGE));
    }
    
    // HTML 조립 및 새 윈도우 인쇄
    const htmlContent = buildPdfHtml(pages, options);
    const printWindow = window.open('', '_blank', 'width=1100,height=800');
    if (!printWindow) {
        alert("팝업이 차단되었습니다. 팝업 허용 후 다시 시도해 주세요.");
        return;
    }
    
    printWindow.document.write(htmlContent);
    printWindow.document.close();
    printWindow.onload = () => {
        setTimeout(() => { printWindow.print(); }, 300);
    };
}
```

---

## 2. Excel 내보내기 패턴 (XLSX 동적 임포트)

엑셀 저장 기능은 번들 크기 최소화를 위해 `xlsx` 패키지를 전역적으로 가져오지 않고, **다운로드 함수 호출 시점에만 비동기 동적 임포트(Dynamic Import)** 해야 합니다.

### 2.1 파일 통합 규칙
*   **통합 파일**: 모든 엑셀 다운로드 헬퍼는 개별 파일을 새로 만들지 않고, [`src/lib/excelExport.ts`](../../../src/lib/excelExport.ts) 하나의 공용 파일 내에 함수를 추가하여 관리합니다.

### 2.2 구현 5단계 및 예시 코드
```typescript
export async function downloadDriveLogsExcel(
    records: any[],
    filename = '운행일지',
    { onError }: { onError?: (msg: string) => void } = {}
) {
    // 1단계: 데이터 체크
    if (!records || records.length === 0) {
        onError?.('다운로드할 데이터가 없습니다.');
        return;
    }

    // 2단계: xlsx 동적 임포트 (중요!)
    const XLSX = await import('xlsx');

    // 3단계: 사용자 친화적인 한글 헤더 매핑
    const rows = records.map(rec => ({
        '일자': rec.date,
        '차량번호': rec.vehicleNumber,
        '운행전km': rec.startKm,
        '운행후km': rec.endKm,
        '목적': rec.purpose
    }));

    // 4단계: 워크시트 생성 및 열 너비(wch) 지정
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
        { wch: 12 }, // 일자
        { wch: 15 }, // 차량번호
        { wch: 12 }, // 운행전km
        { wch: 12 }, // 운행후km
        { wch: 25 }  // 목적
    ];

    // 5단계: 워크북 생성 및 파일 쓰기
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '기록');
    XLSX.writeFile(wb, `${filename}.xlsx`);
}
```

---

## 3. 핵심 아키텍처 규칙

1.  **팝업 및 다운로드 에러 처리**: 브라우저 보안으로 인해 `window.open`이나 파일 저장이 차단되는 상황을 대비해 `onError` 콜백을 넘겨 UI에서 `useToast` 또는 Toast 팝업을 통해 대응해야 합니다.
2.  **날짜 형식 통일**: 출력 파일명이나 본문 데이터 표기 시 항상 `dateUtils.ts` 또는 `pdfStyles`의 `formatDate`를 호출해 일관성 있는 날짜 표기 형식(`YYYY-MM-DD HH:mm`)을 갖춰야 합니다.
