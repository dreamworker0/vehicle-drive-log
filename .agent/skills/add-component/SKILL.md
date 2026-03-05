---
name: add-component
description: 프로젝트 구조와 네이밍 컨벤션에 맞게 새 React 컴포넌트를 추가하는 가이드
---

# 새 컴포넌트 추가 스킬

## 프로젝트 컴포넌트 구조

```
src/components/
├── admin/       ← 기관관리자 전용 (AdminLayout 하위 라우트)
├── employee/    ← 기관직원 전용 (EmployeeLayout 하위 라우트)
├── auth/        ← 인증/온보딩 (로그인, 초대코드, 기관신청)
├── common/      ← 공통 UI 컴포넌트 (알림벨, 캘린더 등)
├── superAdmin/  ← 슈퍼관리자 전용 (SuperAdminLayout 하위 라우트)
```

## 이미 있는 컴포넌트 이름 패턴

- **Layout**: `AdminLayout.jsx`, `EmployeeLayout.jsx`, `SuperAdminLayout.jsx`
  - 사이드바, 탭 네비게이션, 라우팅을 포함하는 최상위 레이아웃
- **목록/관리**: `DriveLogList.jsx`, `VehicleManager.jsx`, `EmployeeManager.jsx`
- **폼**: `DriveLogForm.jsx`
- **대시보드**: `TodayDashboard.jsx`, `MonthlyReport.jsx`
- **페이지**: `LoginPage.jsx`, `InviteCodePage.jsx`, `OrgApplicationPage.jsx`

### 공통 컴포넌트 (`common/`) — 새 컴포넌트 추가 전 재사용 여부 확인

| 컴포넌트 | 역할 |
|---------|------|
| `ConfirmModal` | 확인/취소 모달, 텍스트 입력 모달 (type: confirm/input) |
| `CalendarGrid` | 달력 그리드 UI |
| `ReservationCalendar` | 예약 달력 (관리자/직원 공용) |
| `ReservationSidePanel` | 예약 사이드 패널 |
| `VehicleTimelineBar` | 차량별 예약 타임라인 바 |
| `NotificationBell` | 알림 벨 아이콘 + 드롭다운 |
| `ErrorBoundary` | React 에러 경계 |
| `OfflineBanner` | 오프라인 상태 안내 배너 |
| `Skeleton` | 로딩 스켈레톤 |
| `FeedbackForm` | 사용자 피드백 폼 |
| `UserManual` | 사용 설명서 |
| `InstallPrompt` / `IOSInstallPrompt` | PWA 설치 안내 |
| `UpdatePrompt` | 앱 업데이트 안내 |

## 컴포넌트 추가 절차

### 1. 파일 생성

적절한 하위 폴더에 `PascalCase.jsx` 파일을 생성합니다.

```jsx
import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';

export default function NewComponent() {
    const { user, userData } = useAuth();

    return (
        <div className="space-y-6">
            <h2 className="text-xl font-bold text-surface-900 dark:text-surface-100">제목</h2>
            {/* 내용 */}
        </div>
    );
}
```

### 2. 스타일링 규칙

- **TailwindCSS v3** 사용 (커스텀 색상: `primary-*`, `surface-*`)
- 반응형: 모바일 퍼스트 (`md:`, `lg:` 접두사로 데스크톱 대응)
- 카드: `glass-card p-5` (다크 모드 자동 포함)
- 버튼: `btn-primary`, `btn-secondary` (다크 모드 자동 포함)
- **다크 모드 필수**: 인라인 색상 사용 시 `dark:` 변형 반드시 함께 작성 (예: `text-surface-900 dark:text-surface-100`)
  - 상세 매핑은 `design-system.md`의 "다크 모드 필수 규칙" 참고
- **배지(Badge) 클래스 필수 사용**: 상태 배지는 `index.css`에 정의된 공통 클래스를 사용 (다크 모드 자동 포함)
  - `badge-primary` — 파란 계열 (예약 건수 등)
  - `badge-success` — 초록 계열 (완료, 승인 등)
  - `badge-warning` — 노란 계열 (운행 중, 대기 등)
  - `badge-danger` — 빨간 계열 (미확인, 반려, 삭제 등)
  - `badge-neutral` — 회색 계열 (예약됨, 기본 상태 등)
  - 인라인으로 `bg-red-100 text-red-700` 같은 배지 색상을 직접 작성하지 말 것
- **브라우저 팝업 사용 금지**: `alert()`, `confirm()`, `prompt()` 절대 사용 금지
  - 확인/취소가 필요하면 `ConfirmModal` (type="confirm") 사용
  - 텍스트 입력이 필요하면 `ConfirmModal` (type="input") 사용
  - Import: `import ConfirmModal from '../common/ConfirmModal';`

### 2-1. 탭 UI 패턴 (필수 준수)

두 개 이상의 탭으로 콘텐츠를 전환하는 UI가 필요하면 아래 패턴을 그대로 사용합니다.

```jsx
{/* 탭 컨테이너 */}
<div className="flex gap-1 mb-4 bg-surface-100 dark:bg-surface-800 rounded-xl p-1">
    <button
        onClick={() => setTab('first')}
        className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all
            ${tab === 'first'
                ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-surface-100 shadow-sm'
                : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:text-surface-300'}`}
    >
        첫 번째 탭
    </button>
    <button
        onClick={() => setTab('second')}
        className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all
            ${tab === 'second'
                ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-surface-100 shadow-sm'
                : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:text-surface-300'}`}
    >
        두 번째 탭
    </button>
</div>
```

**핵심 규칙:**
- 선택 상태: `bg-white dark:bg-surface-700 text-surface-900 dark:text-surface-100 shadow-sm`
- 비선택 상태: `text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:text-surface-300`
- 위험/삭제 탭만 선택 시 `text-red-600 dark:text-red-400` 사용 가능
- 컨테이너: `flex gap-1 mb-4 bg-surface-100 dark:bg-surface-800 rounded-xl p-1`

### 3. Firestore 함수 연동

Firestore 조회/수정 함수는 `src/lib/firestore.js`에서 import합니다:

```jsx
import { getVehicles, createDriveLog } from '../../lib/firestore';
```

### 4. 라우트 등록

해당 Layout 파일에서 라우트를 추가합니다:

- `AdminLayout.jsx` → admin 컴포넌트
- `EmployeeLayout.jsx` → employee 컴포넌트
- `SuperAdminLayout.jsx` → superAdmin 컴포넌트

```jsx
// Layout 파일 내 Routes에 추가
<Route path="new-feature" element={<NewComponent />} />
```

사이드바/탭에 네비게이션 링크도 추가합니다.

### 5. 검증

```bash
npm run build  # 빌드 에러 없는지 확인
npm run lint   # ESLint 통과 확인
```

- 다크 모드 확인: 브라우저에서 다크/라이트 모드 전환하여 텍스트 대비, 배경색, 배지 색상 이상 없는지 육안 확인
