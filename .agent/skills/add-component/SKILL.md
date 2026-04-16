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
| `ConfirmModal` | 확인/취소 모달, 텍스트 입력 모달 |
| `CalendarGrid` | 달력 그리드 UI |
| `ReservationCalendar` | 예약 달력 (관리자/직원 공용) |
| `NotificationBell` | 알림 벨 아이콘 + 드롭다운 |
| `ErrorBoundary` | React 에러 경계 |
| `OfflineBanner` | 오프라인 상태 안내 배너 |
| `Skeleton` | 로딩 스켈레톤 |
| `FeedbackForm` | 사용자 피드백 폼 |
| `SEOHead` | SEO 메타 태그 |
| `PublicNav` | 공개 페이지 네비게이션 |

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
