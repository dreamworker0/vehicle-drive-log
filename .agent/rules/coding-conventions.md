---
description: 차량 운행일지 앱 코딩 컨벤션 및 에이전트 행동 규칙. 코드를 작성하거나 수정할 때 반드시 따른다.
---

# 🤖 코딩 컨벤션 & 에이전트 규칙

이 문서는 에이전트가 차량 운행일지 앱의 코드를 작성할 때 따라야 할 규칙이다.

---

## 1. 프로젝트 구조

```
src/
├── components/
│   ├── auth/           ← 인증 관련 (LoginPage, InviteCodePage 등)
│   ├── superAdmin/     ← 슈퍼관리자 전용 화면
│   ├── admin/          ← 기관관리자 전용 화면
│   ├── employee/       ← 직원 전용 화면
│   └── common/         ← 역할 공용 컴포넌트
├── hooks/              ← React 커스텀 훅 (아래 주요 훅 목록 참고)
├── lib/                ← 유틸리티 & 서비스
│   ├── firebase.ts     ← Firebase 초기화 (app, auth, db, storage)
│   ├── firebaseAuth.ts ← Firebase Auth 헬퍼 (토큰 재발급 등)
│   ├── firestore/      ← Firestore CRUD 함수 (도메인별 분리)
│   ├── auth.ts         ← 인증 유틸리티
│   ├── authFetch.ts    ← 인증된 fetch 래퍼 (토큰 자동 첨부)
│   ├── constants.ts    ← 공유 상수 (차량 아이콘, 색상 등)
│   ├── dateUtils.ts    ← 날짜 포맷·계산 헬퍼
│   ├── tmap.ts         ← Tmap API 연동
│   ├── ocr.ts          ← OCR Cloud Function 호출
│   ├── pdfExport.ts    ← 운행일지 PDF 내보내기
│   ├── pdfStyles.ts    ← PDF 공통 스타일
│   ├── dailyLogPdfExport.ts ← 일일 운행일지 PDF
│   ├── fuelLogPdfExport.ts  ← 주유 기록 PDF
│   ├── hipassChargePdfExport.ts ← 하이패스 충전 PDF
│   ├── maintenancePdfExport.ts  ← 정비 기록 PDF
│   ├── excelExport.ts  ← Excel 내보내기
│   ├── emailService.ts ← EmailJS 연동
│   ├── holidayApi.ts   ← 공휴일 API
│   ├── holiday.ts      ← 공휴일 헬퍼
│   ├── inAppBrowser.ts ← 인앱 브라우저 감지·안내
│   ├── sentry.ts       ← Sentry 초기화
│   ├── lazyWithRetry.ts← Lazy loading 재시도 유틸
│   ├── offlineQueue.ts ← 오프라인 큐 (PWA 지원)
│   ├── tokenRefresh.ts ← 토큰 갱신 유틸
│   ├── vehicleUtils.ts ← 차량 유틸리티
│   ├── timelineUtils.ts← 타임라인 유틸리티
│   ├── faqData.ts      ← FAQ 데이터
│   ├── manualSections.ts← 사용 설명서 섹션 데이터
│   └── releaseNotes.ts ← 릴리스 노트 데이터
├── contexts/           ← React Context (ConfirmContext, ThemeContext, FontSizeContext)
├── index.css           ← TailwindCSS + 커스텀 스타일
├── App.tsx             ← 역할별 라우팅
└── main.tsx            ← React 엔트리
```

### 파일 위치 결정 기준
- **역할 전용 화면** → `components/{role}/`에 생성
- **2개 이상 역할에서 사용** → `components/common/`
- **데이터 접근 함수** → `lib/firestore/해당도메인.ts`에 추가
- **새 커스텀 훅** → `hooks/`에 생성
- **외부 API 연동** → `lib/`에 별도 파일

### 1.1 커스텀 훅(Custom Hooks) 사용 기준

- 컴포넌트 내 상태(State) 로직이 복잡해질 경우, 반드시 `src/hooks/` 내부의 커스텀 훅으로 분리한다.
- 현재 정의되어 있는 주요 훅 목록 및 용도:
  - `useAuth`: 현재 사용자 정보(Current User) 및 인증 상태(Authentication State) 관리.
  - `useToast`: 공통 Toast 메시지 팝업 트리거 및 상태 관리.
  - `useReservations`: Firestore 예약 데이터 구독 및 조회 (현재 로그인한 사용자 관련 데이터 위주).
  - `useVehicles`: 전체/소속 기관(Organization)의 차량 정보 로드 및 상태 관리.
  - `useOrganizations`: 사용자 소속 기관 목록 및 활성 기관 상태 관리.
  - `useReservationCalendar`: 예약 달력, 월별 탐색 및 캘린더 UI 렌더링 상태 분리.
  - `useNotification`: 알림(Notification) 읽음 처리 및 상태 관리.

- **규칙**: 컴포넌트에서는 UI 렌더링에 집중하고, 복잡한 데이터 로딩이나 변환 로직은 위 훅들을 재사용하거나 신규 훅을 생성하여 위임한다.

### 주요 커스텀 훅 목록
| 훅 | 역할 |
|---|---|
| `useAuth` | 인증 상태 + 사용자 정보 (전역 Context) |
| `useToast` | 토스트 알림 표시 (전역 Context) |
| `useAdminBadges` | 관리자 사이드바 배지 실시간 구독 |
| `useTodayDashboard` | 오늘 대시보드 데이터 (예약·운행 현황) |
| `useReservationCalendar` | 예약 캘린더 로직 |
| `useDriveLogForm` | 운행일지 작성 폼 로직 |
| `useDriveLogOcr` | 운행일지 OCR 관련 로직 |
| `useMonthlyReport` | 월간 보고서 데이터 |
| `useAnalytics` | 분석 대시보드 데이터 |
| `useVehicleManager` | 차량 관리 CRUD |
| `useVehicleHistory` | 차량별 이용 내역 조회 |
| `useEmployeeManager` | 직원 관리 CRUD |
| `useMaintenanceLog` | 차량 정비 기록 |
| `useSettings` | 기관 설정 관리 |
| `useNotification` | FCM 푸시 알림 토큰 관리 |
| `useOrgApplication` | 기관 신청 폼 로직 |
| `useQuickDriveStart` | 예약 없이 바로 운행 시작 |
| `useBackButton` | 모바일 뒤로가기 처리 |
| `useForceLightMode` | 랜딩/인증 페이지 강제 라이트 모드 |
| `useOrientationLock` | 화면 회전 잠금 (PDF 출력 시 가로 모드) |
| `useRetry` | 재시도 로직 (에러 시 자동 재시도) |
| `useTimelineDrag` | 타임라인 드래그 로직 |
| `useDailyLog` | 일일 운행일지 관리 |
| `useFuelLog` | 주유 기록 관리 |
| `useFuelLogAdmin` | 주유 기록 관리자 기능 |
| `useHipassCharge` | 하이패스 충전 기록 관리 |
| `useHipassChargeAdmin` | 하이패스 충전 관리자 기능 |
| `useHipassManager` | 하이패스 단말기 관리 CRUD |
| `useVehiclePriority` | 차량 우선순위 관리 |

> ✅ 새 기능 추가 시 **기존 훅과 역할이 겹치지 않는지** 먼저 확인한다.

---

## 2. 컴포넌트 작성 규칙

### 2.1 함수 컴포넌트 + named export
```jsx
// ✅ 권장
export default function ComponentName() { ... }

// ❌ 비권장
const ComponentName = () => { ... };
export default ComponentName;
```

### 2.2 파일 내 구조 순서
```jsx
// 1. import
import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { getData } from '../../lib/firestore';

// 2. 상수 (파일 최상단, 컴포넌트 밖)
const CONSTANTS = [...];

// 3. 헬퍼 함수 (컴포넌트 밖)
const helperFunction = (param) => { ... };

// 4. 메인 컴포넌트
export default function MainComponent() {
    // 4a. hooks (useAuth, useNavigate, useState, useEffect 순)
    // 4b. 파생 상태 (useMemo, computed values)
    // 4c. 이벤트 핸들러 (handle~, on~)
    // 4d. 로딩 상태 early return
    // 4e. JSX return
}

// 5. 보조 컴포넌트 (같은 파일 내)
function SubComponent({ props }) { ... }
```

### 2.3 상태 관리
- **전역 상태**: `useAuth` 컨텍스트 (인증 + 사용자 정보)
- **로컬 상태**: `useState` (컴포넌트별 UI 상태)
- **서버 데이터**: `useEffect` + `useState`로 직접 fetch
- **실시간 구독**: `onSnapshot` 사용 시 반드시 cleanup 반환
```jsx
useEffect(() => {
    const unsubscribe = onSnapshot(query, (snap) => { ... });
    return () => unsubscribe();
}, [dependencies]);
```

---

## 3. Firestore 사용 패턴

### 3.1 CRUD 함수는 `lib/firestore/` 도메인별 파일에 집중
```ts
// ✅ 도메인 파일에서 export (e.g. firestore/vehicles.ts)
export const getVehicles = async (orgId: string) => { ... };
export const createReservation = async (data: Record<string, unknown>) => { ... };

// ✅ index.ts에서 re-export
export { getVehicles } from './vehicles';
export { createReservation } from './reservations';

// ✅ 컴포넌트에서 import
import { getVehicles, createReservation } from '../../lib/firestore';

// ❌ 컴포넌트에서 직접 Firestore 호출 (지양)
// (단, 간단한 getDoc 1회 호출은 컴포넌트에서 허용)
```

### 3.2 데이터 비정규화
- `driveLogs`에는 `driverName`, `vehicleDisplayName` 저장 (JOIN 방지)
- `reservations`에는 `reservedByName`, `vehicleName` 저장
- 비정규화된 필드는 원본 변경 시 함께 업데이트

### 3.3 조직 격리
- **모든 쿼리**에 `organizationId` 조건 포함
- 함수 첫 파라미터로 `orgId` 전달

### 3.4 에러 처리
```jsx
import { useToast } from '../../hooks/useToast';
const { showToast } = useToast();

try {
    await someFirestoreOp();
} catch (err) {
    console.error('한글 설명:', err);
    showToast('사용자 친화적 에러 메시지', 'error');
}
```
> ⚠️ 브라우저 기본 `alert()` 대신 반드시 `useToast` 훅을 사용한다.

---

## 4. 네이밍 컨벤션

| 대상 | 규칙 | 예시 |
|------|------|------|
| 컴포넌트 파일 | PascalCase | `TodayDashboard.tsx` |
| 유틸 파일 | camelCase | `firestore.ts`, `holidayApi.ts` |
| 컴포넌트 함수 | PascalCase | `function TodayDashboard()` |
| 이벤트 핸들러 | `handle` + 동사 | `handleStartDrive`, `handleSubmit` |
| 상태 변수 | camelCase | `loading`, `todayReservations` |
| 상태 setter | `set` + 변수명 | `setLoading`, `setTodayReservations` |
| 상수 | UPPER_SNAKE_CASE | `VEHICLE_COLORS`, `VEHICLE_TYPE_ICONS` |
| Firestore 함수 | 동사 + 명사 | `getVehicles`, `createReservation` |
| CSS 클래스 (커스텀) | kebab-case | `glass-card`, `btn-primary`, `driving-badge` |
| 한글 주석 | 용도 설명 | `// 운행 시작 (예약에서)` |

---

## 5. 공통 패턴

### 5.1 페이지 구조
```jsx
return (
    <div className="max-w-4xl mx-auto animate-fade-in"> {/* 또는 max-w-lg */}
        {/* 헤더 영역 */}
        <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">페이지 제목</h1>
            <button className="btn-primary btn-sm">액션 버튼</button>
        </div>

        {/* 콘텐츠 */}
        <div className="glass-card p-5">
            ...
        </div>
    </div>
);
```

### 5.2 로딩 상태
```jsx
if (loading) {
    return (
        <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 spinner" />
        </div>
    );
}
```

### 5.3 빈 상태
```jsx
<div className="glass-card p-8 text-center">
    <div className="text-4xl mb-3">📋</div>
    <p className="text-surface-500 dark:text-surface-400 mb-2">데이터가 없습니다</p>
    <button className="btn-sm btn-primary">생성하기</button>
</div>
```

### 5.4 확인 다이얼로그 (useConfirm 훅)
```tsx
import { useConfirm } from '../../contexts/ConfirmContext';

const { confirm } = useConfirm();

// 확인/취소
const ok = await confirm({
    message: '정말 삭제하시겠습니까?',
    title: '삭제 확인',              // 선택
    confirmText: '삭제',             // 선택 (기본: '확인')
    confirmColor: 'danger',          // 'primary' | 'danger' | 'warning'
});
if (!ok) return;

// ... 삭제 로직 실행
```
> ⛔ **`window.confirm()`, `window.alert()`, `window.prompt()` 절대 사용 금지**
> - ESLint `no-restricted-globals` 규칙으로 자동 감지됨
> - 확인/취소 → `useConfirm().confirm()` 훅 사용
> - 알림 → `useToast().showToast()` 사용
> - 텍스트 입력 → 별도 모달 또는 폼 UI 구성

### 5.5 알림/토스트
```ts
import { useToast } from '../../hooks/useToast';
const { showToast } = useToast();
showToast('저장되었습니다', 'success');  // type: 'success' | 'error' | 'info'
```
- 커스텀 훅 `useToast`를 사용 (`hooks/useToast.tsx`)
- 브라우저 기본 `alert()` 대신 이 훅을 사용한다

---

## 6. 차량 관련 상수 (공유)

프로젝트 전체에서 반복되는 상수들. 새 컴포넌트에서 차량을 표시할 때 동일하게 사용한다:

```js
const VEHICLE_TYPE_ICONS = { compact: '🚙', sedan: '🚗', van: '🚐', bus: '🚌' };

const VEHICLE_COLORS = [
    'bg-red-200', 'bg-blue-200', 'bg-yellow-200', 'bg-green-200', 'bg-purple-200',
    'bg-orange-300', 'bg-cyan-200', 'bg-pink-300', 'bg-indigo-300', 'bg-lime-300',
];

const getVehicleColor = (id) => {
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash) + id.charCodeAt(i);
    return VEHICLE_COLORS[Math.abs(hash) % VEHICLE_COLORS.length];
};
```

> ✅ 이 상수들은 `lib/constants.ts`에 통합되어 있다. 새 컴포넌트에서는 반드시 여기서 import한다.
> ```js
> import { VEHICLE_TYPE_ICONS, getVehicleColor } from '../../lib/constants';
> ```

---

## 7. 기술 스택 제약사항

- **React**: 함수 컴포넌트 + Hooks만 사용 (클래스 컴포넌트 금지)
- **TypeScript**: `any` 타입 사용을 엄격히 금지한다. 타입을 구체적으로 정의하거나 `unknown`을 사용 후 타입 단언/타입 가드를 이용해 처리한다 (`@typescript-eslint/no-explicit-any` 경고 제로화 유지).
- **TailwindCSS v3**: `@apply`, `@layer` 사용 가능, v4 문법 사용 금지
- **라우팅**: React Router v6 (`Routes`, `Route`, `NavLink`, `useNavigate`, `useLocation`)
- **Firebase**: v9+ Modular SDK (`import { ... } from 'firebase/firestore'`)
- **빌드**: Vite (HMR, ESM)
- **Node.js**: v22 (Firebase Functions 호환성)

---

## 8. 코드 품질 규칙

1. **불필요한 의존성 금지**: 이미 사용 중인 라이브러리로 해결 가능하면 새 라이브러리를 추가하지 않는다
2. **한글 커밋 메시지**: 의미 있는 한글로 작성
3. **console.error**: 에러 로깅 시 한글 설명 포함 (`console.error('로드 실패:', err)`)
4. **JSX 중복 최소화**: 반복되는 UI 패턴은 함수 또는 서브 컴포넌트로 추출
5. **하드코딩 금지**: 역할명(`'admin'`, `'employee'`), 이메일(`'ehsheh@gmail.com'`) 등은 상수로 관리
6. **외부 API (Rate Limit & 캐싱)**: TMap 등 외부 API를 호출할 때는 `429 Too Many Requests` 에러를 방지하고 비용을 절감하기 위해 불필요한 호출을 최소화해야 한다. `localStorage`, 인메모리 캐싱 또는 큐(Queue) 패턴을 적용하여 안정성을 확보한다.
