---
name: add-excel-export
description: 새 Excel 내보내기 함수를 추가할 때 기존 패턴을 따르는 가이드
---

# Excel 내보내기 모듈 추가 스킬

## 기존 Excel 모듈 현황

모든 Excel 함수는 `src/lib/excelExport.ts` 한 파일에 모여 있다:

| 함수 | 시트명 | 용도 |
|------|--------|------|
| `downloadDriveLogsExcel` | 운행일지 | 운행일지 기록 엑셀 다운로드 |
| `downloadMaintenanceExcel` | 정비기록 | 정비 기록 엑셀 다운로드 |
| `downloadFuelLogsExcel` | 주유기록 | 주유 기록 엑셀 다운로드 |
| `downloadHipassChargesExcel` | 하이패스충전기록 | 하이패스 충전 기록 엑셀 다운로드 |

## 공통 패턴

모든 Excel export 함수는 동일한 구조를 따른다:

### 1. 함수 시그니처

```ts
export async function downloadNewExcel(
    records: NewRecord[],
    filename = '시트명',
    { onError }: { onError?: (msg: string) => void } = {},
) {
```

### 2. 함수 구조 (5단계)

```ts
// 1단계: 빈 데이터 체크
if (!records || records.length === 0) {
    onError?.('다운로드할 데이터가 없습니다.');
    return false;
}

// 2단계: xlsx 동적 import (번들 최적화)
const XLSX = await import('xlsx');

// 3단계: 데이터 변환 (한글 헤더 사용)
const rows = records.map((rec) => ({
    '날짜': rec.date || '',
    '항목이름': rec.value || '',
    // ...
}));

// 4단계: 워크시트 생성 + 열 너비 설정
const ws = XLSX.utils.json_to_sheet(rows);
ws['!cols'] = [
    { wch: 12 },  // 날짜
    { wch: 14 },  // 항목이름
];

// 5단계: 워크북 생성 및 다운로드
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, '시트명');
XLSX.writeFile(wb, `${filename}.xlsx`);
```

## 새 Excel 함수 추가 절차

1. **인터페이스 정의**: `src/lib/excelExport.ts` 파일에 새 인터페이스 추가
2. **함수 구현**: 위 5단계 패턴 그대로 구현
3. **컴포넌트 연동**: 해당 페이지에서 다운로드 버튼에 연결

```tsx
import { downloadNewExcel } from '../../lib/excelExport';

const handleExcelDownload = async () => {
    await downloadNewExcel(records, `파일명_${새날짜}`, {
        onError: (msg) => showToast(msg, 'error'),
    });
};
```

## 핵심 규칙

1. **동적 import 필수**: `const XLSX = await import('xlsx')` — 번들 크기 최적화
2. **한글 헤더**: 열 키는 반드시 한글로 작성 (사용자가 바로 읽을 수 있도록)
3. **열 너비(wch)**: 한글 기준 `wch` 값 설정 (날짜 12, 이름 10~14, 금액 12, 비고 20~24)
4. **빈 데이터 체크**: `onError` 콜백으로 에러 메시지 전달 (컴포넌트에서 `showToast` 사용)
5. **파일 하나에 통합**: 새 함수는 기존 `excelExport.ts`에 추가 (별도 파일 생성하지 않음)
6. **Timestamp 변환**: Firestore Timestamp → Date 변환 패턴 재사용
   ```ts
   const ca = rec.createdAt as any;
   const d = ca instanceof Date ? ca : ca?.toDate?.() || null;
   ```
