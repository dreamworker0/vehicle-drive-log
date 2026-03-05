---
name: add-hook
description: 프로젝트 컨벤션에 맞게 새 커스텀 훅을 추가하는 가이드
---

# 커스텀 훅 추가 스킬

## 기존 훅 현황

새 훅을 만들기 전에 **기존 훅과 역할이 겹치지 않는지** 반드시 확인한다.

| 훅 | 역할 | 위치 |
|---|---|---|
| `useAuth` | 인증 상태 + 사용자 정보 (전역 Context) | `hooks/useAuth.jsx` |
| `useToast` | 토스트 알림 표시 (전역 Context) | `hooks/useToast.jsx` |
| `useTodayDashboard` | 오늘 대시보드 (예약·운행 현황) | `hooks/useTodayDashboard.js` |
| `useReservationCalendar` | 예약 캘린더 로직 | `hooks/useReservationCalendar.js` |
| `useDriveLogForm` | 운행일지 작성 폼 로직 | `hooks/useDriveLogForm.js` |
| `useMonthlyReport` | 월간 보고서 데이터 | `hooks/useMonthlyReport.js` |
| `useAnalytics` | 분석 대시보드 데이터 | `hooks/useAnalytics.js` |
| `useVehicleManager` | 차량 관리 CRUD | `hooks/useVehicleManager.js` |
| `useEmployeeManager` | 직원 관리 CRUD | `hooks/useEmployeeManager.js` |
| `useMaintenanceLog` | 차량 정비 기록 | `hooks/useMaintenanceLog.js` |
| `useSettings` | 기관 설정 관리 | `hooks/useSettings.js` |
| `useNotification` | 알림 구독·표시 | `hooks/useNotification.js` |
| `useQuickDriveStart` | 예약 없이 바로 운행 시작 | `hooks/useQuickDriveStart.js` |
| `useBackButton` | 모바일 뒤로가기 처리 | `hooks/useBackButton.js` |
| `useForceLightMode` | 랜딩/인증 페이지 강제 라이트 모드 | `hooks/useForceLightMode.js` |

## 훅 생성 규칙

### 네이밍

- 파일명: `use` + PascalCase + `.js` (예: `useNewFeature.js`)
- Context 기반 훅만 `.jsx` (JSX 문법이 필요한 경우)
- 함수명: `use` + PascalCase (예: `export default function useNewFeature()`)

### 파일 구조 템플릿

```js
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from './useAuth';
import { getData, createData } from '../lib/firestore';

/**
 * useNewFeature — 기능 설명 (한국어)
 * 사용 컴포넌트: ComponentName
 */
export default function useNewFeature() {
    const { userData } = useAuth();
    const orgId = userData?.organizationId;

    // 1. 상태 선언
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);

    // 2. 데이터 로드
    useEffect(() => {
        if (!orgId) return;
        const load = async () => {
            try {
                const data = await getData(orgId);
                setItems(data);
            } catch (err) {
                console.error('데이터 로드 실패:', err);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [orgId]);

    // 3. 파생 상태 (useMemo)
    const computed = useMemo(() => {
        // 계산 로직
        return items.length;
    }, [items]);

    // 4. 이벤트 핸들러
    const handleCreate = async (data) => {
        await createData({ ...data, organizationId: orgId });
        // 목록 새로고침 또는 상태 업데이트
    };

    // 5. 리턴 (컴포넌트에서 사용할 값들)
    return {
        items,
        loading,
        computed,
        handleCreate,
    };
}
```

### 구조 패턴 분류

| 패턴 | 설명 | 예시 |
|------|------|------|
| **데이터 훅** | Firestore 데이터 조회·가공 | `useTodayDashboard`, `useAnalytics` |
| **폼 훅** | 폼 상태·유효성검사·제출 로직 | `useDriveLogForm` |
| **CRUD 훅** | 목록 조회 + 생성·수정·삭제 핸들러 | `useVehicleManager`, `useEmployeeManager` |
| **Context 훅** | 전역 상태 제공 (Provider 필요) | `useAuth`, `useToast` |

## 컴포넌트에서 사용

```jsx
import useNewFeature from '../../hooks/useNewFeature';

export default function NewComponent() {
    const { items, loading, handleCreate } = useNewFeature();

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 spinner" />
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* items 렌더링 */}
        </div>
    );
}
```

## 주의사항

1. **모든 Firestore 호출은 `lib/firestore.js` 경유**: 훅에서 직접 `getDoc()` 등을 호출하지 않는다
2. **organizationId 필수**: 대부분의 데이터는 기관 격리 (`useAuth`에서 가져온 orgId 사용)
3. **cleanup 필수**: `onSnapshot` 사용 시 `useEffect` return에 unsubscribe
4. **loading 상태 필수**: 비동기 데이터는 반드시 loading 상태를 반환
5. **에러 처리**: `console.error('한글 설명:', err)` 형식, UI 알림은 `useToast` 사용

## 검증

```bash
npm run build  # 빌드 에러 없는지 확인
npm run lint   # ESLint 통과 확인
```
