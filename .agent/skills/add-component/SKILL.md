---
name: add-component
description: 프로젝트 구조와 네이밍 컨벤션에 맞게 새 React 컴포넌트를 추가하는 가이드
---

# 새 컴포넌트 추가 스킬

## 추가 절차

### 1. 위치 결정

```
src/components/
├── admin/       ← 기관관리자 전용 (AdminLayout 하위 라우트)
├── employee/    ← 기관직원 전용 (EmployeeLayout 하위 라우트)
├── auth/        ← 인증/온보딩 (로그인, 초대코드, 기관신청)
├── common/      ← 공통 UI 컴포넌트 (2개 이상 역할에서 사용)
├── superAdmin/  ← 슈퍼관리자 전용 (SuperAdminLayout 하위 라우트)
```

> 상세 위치 결정 기준: [agents.md §5.2](../agents.md)

### 2. 기존 공통 컴포넌트 재사용 확인

새 컴포넌트를 만들기 전에 `common/`에 이미 있는지 확인:

| 컴포넌트 | 역할 |
|---------|------|
| `ConfirmModal` | 확인/취소 모달, 단순 텍스트 입력 모달 |
| `CalendarGrid` | 달력 그리드 UI 뼈대 |
| `ReservationCalendar` | 예약 달력 (관리자/직원 공용 통합 캘린더) |
| `NotificationBell` | 신규 알림 수신 배지 표시 및 알림 드롭다운 |
| `ErrorBoundary` | 하위 컴포넌트 렌더링 실패 시 대체 UI 제공 및 에러 리포팅 |
| `OfflineBanner` | 네트워크 오프라인 상태 안내 상단 배너 |
| `Skeleton` | 비동기 로딩 중 보여줄 스켈레톤 레이아웃 |
| `FeedbackForm` | 사용자 피드백 제출 전용 폼 모달 |
| `SEOHead` | HTML head 메타 태그 (SEO 용도) 삽입기 |
| `PublicNav` | 공개 랜딩/인증 페이지 상단 네비게이션바 |
| `AskAIModal` | AI 조수 비서 연동 및 대화 질의 모달 |
| `CancelReservationHandler` | 차량 예약 취소 처리 공용 UI/로직 핸들러 |
| `DocumentViewer` | 증빙 서류 및 차량 사진 뷰어 오버레이 |
| `HeatmapGrid` | 사용 빈도 및 배차 밀도 시각화용 맵 그리드 |
| `IOSInstallPrompt` | iOS(Safari) 모바일 환경 PWA 설치 가이드 모달 |
| `InAppBrowserWarning` | 카카오톡 등 앱 내부 브라우저 진입 시 외부 브라우저 실행 안내 |
| `InstallPrompt` | 일반 PWA 설치 유도 모달 (A2HS 지원) |
| `PublicFeedbackModal` | 비로그인 사용자용 공개 피드백 제출 모달 |
| `ReservationSidePanel` | 예약 클릭 시 슬라이딩되는 세부 예약 정보/관리 패널 |
| `UpdatePrompt` | 앱 최신 업데이트 배포 시 감지 및 리로드 안내 배너 |
| `UserManual` | 서비스 전체 사용법 및 도움말(FAQ) 오버레이 모달 |
| `VehicleTimelineBar` | 일자별 차량 타임라인(일정 바 형태) 시각화 컴포넌트 |

### 3. 파일 생성

`PascalCase.tsx` 파일을 생성한다:

```tsx
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

> 스타일링 상세 규칙: [design-system.md](../rules/design-system.md)
> 다크 모드 색상 페어링 표: [design-system.md §1](../rules/design-system.md)
> 브라우저 팝업 금지 / useConfirm 사용: [agents.md §1 D1~D3](../agents.md)

### 4. 탭 UI 패턴 (2개 이상 탭 전환 시)

```tsx
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
</div>
```

### 5. Firestore 데이터 연동

```tsx
// lib/firestore에서 import (컴포넌트에서 직접 Firestore 호출 금지 → agents.md D9)
import { getVehicles, createDriveLog } from '../../lib/firestore';
```

### 6. 라우트 등록

해당 Layout 파일에서 `lazyWithRetry`로 동적 import:

```tsx
const NewComponent = lazyWithRetry(() => import('./NewComponent'));

// Routes에 추가
<Route path="new-feature" element={<NewComponent />} />
```

사이드바/탭에 네비게이션 링크도 추가한다.

### 7. 검증

자동 교정 루프를 실행한다 → [agents.md §2](../agents.md)
