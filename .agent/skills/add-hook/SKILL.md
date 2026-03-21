---
name: add-hook
description: 프로젝트 컨벤션에 맞게 새 커스텀 훅을 추가하는 가이드
---

# 커스텀 훅 추가 스킬

## 기존 훅 현황

새 훅을 만들기 전에 **기존 훅과 역할이 겹치지 않는지** 반드시 확인한다.

| 훅 | 역할 | 위치 |
|---|---|---|
| `useAuth` | 인증 상태 + 사용자 정보 (전역 Context) | `hooks/useAuth.tsx` |
| `useToast` | 토스트 알림 표시 (전역 Context) | `hooks/useToast.tsx` |
| `useTodayDashboard` | 오늘 대시보드 (예약·운행 현황) | `hooks/useTodayDashboard.ts` |
| `useReservationCalendar` | 예약 캘린더 로직 | `hooks/useReservationCalendar.ts` |
| `useDriveLogForm` | 운행일지 작성 폼 로직 | `hooks/useDriveLogForm.ts` |
| `useDriveLogOcr` | 운행일지 OCR 관련 로직 | `hooks/useDriveLogOcr.ts` |
| `useMonthlyReport` | 월간 보고서 데이터 | `hooks/useMonthlyReport.ts` |
| `useAnalytics` | 분석 대시보드 데이터 | `hooks/useAnalytics.ts` |
| `useVehicleManager` | 차량 관리 CRUD | `hooks/useVehicleManager.ts` |
| `useVehicleHistory` | 차량별 이용 내역 조회 | `hooks/useVehicleHistory.ts` |
| `useEmployeeManager` | 직원 관리 CRUD | `hooks/useEmployeeManager.ts` |
| `useMaintenanceLog` | 차량 정비 기록 | `hooks/useMaintenanceLog.ts` |
| `useSettings` | 기관 설정 관리 | `hooks/useSettings.ts` |
| `useNotification` | FCM 푸시 알림 토큰 관리 | `hooks/useNotification.ts` |
| `useOrgApplication` | 기관 신청 폼 로직 | `hooks/useOrgApplication.ts` |
| `useQuickDriveStart` | 예약 없이 바로 운행 시작 | `hooks/useQuickDriveStart.ts` |
| `useBackButton` | 모바일 뒤로가기 처리 | `hooks/useBackButton.ts` |
| `useForceLightMode` | 랜딩/인증 페이지 강제 라이트 모드 | `hooks/useForceLightMode.ts` |
| `useOrientationLock` | 화면 회전 잠금 (PDF 출력 시 가로 모드) | `hooks/useOrientationLock.ts` |
| `useRetry` | 재시도 로직 (에러 시 자동 재시도) | `hooks/useRetry.ts` |
| `useTimelineDrag` | 타임라인 드래그 로직 | `hooks/useTimelineDrag.ts` |
| `useDailyLog` | 일일 운행일지 관리 | `hooks/useDailyLog.ts` |
| `useFuelLog` | 주유 기록 관리 | `hooks/useFuelLog.ts` |
| `useFuelLogAdmin` | 주유 기록 관리자 기능 | `hooks/useFuelLogAdmin.ts` |
| `useHipassCharge` | 하이패스 충전 기록 관리 | `hooks/useHipassCharge.ts` |
| `useHipassChargeAdmin` | 하이패스 충전 관리자 기능 | `hooks/useHipassChargeAdmin.ts` |
| `useHipassManager` | 하이패스 단말기 관리 CRUD | `hooks/useHipassManager.ts` |
| `useVehiclePriority` | 차량 우선순위 관리 | `hooks/useVehiclePriority.ts` |

### 훅 유틸리티 (`hooks/utils/`)

순수 함수는 훅이 아닌 `hooks/utils/`에 배치:

| 파일 | 역할 |
|------|------|
| `analyticsCalc.ts` | 분석 계산 유틸리티 |
| `driveLogValidation.ts` | 운행일지 유효성 검증 |
| `reservationUtils.ts` | 예약 관련 유틸리티 |

## 훅 생성 규칙

### 네이밍

- 파일명: `use` + PascalCase + `.ts` (예: `useNewFeature.ts`)
- Context 기반 훅만 `.tsx` (JSX 문법이 필요한 경우)
- 함수명: `use` + PascalCase (예: `export default function useNewFeature()`)

### 파일 구조 템플릿

```ts
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
    const [items, setItems] = useState<Record<string, unknown>[]>([]);
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
        return items.length;
    }, [items]);

    // 4. 이벤트 핸들러
    const handleCreate = async (data: Record<string, unknown>) => {
        await createData({ ...data, organizationId: orgId });
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
| **폼 훅** | 폼 상태·유효성검사·제출 로직 | `useDriveLogForm`, `useOrgApplication` |
| **CRUD 훅** | 목록 조회 + 생성·수정·삭제 핸들러 | `useVehicleManager`, `useEmployeeManager` |
| **Context 훅** | 전역 상태 제공 (Provider 필요) | `useAuth`, `useToast` |
| **유틸 훅** | 브라우저/UI 관련 기능 | `useBackButton`, `useForceLightMode`, `useOrientationLock` |

## 컴포넌트에서 사용

```tsx
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

1. **모든 Firestore 호출은 `lib/firestore` 경유**: 훅에서 직접 `getDoc()` 등을 호출하지 않는다
2. **organizationId 필수**: 대부분의 데이터는 기관 격리 (`useAuth`에서 가져온 orgId 사용)
3. **cleanup 필수**: `onSnapshot` 사용 시 `useEffect` return에 unsubscribe
4. **loading 상태 필수**: 비동기 데이터는 반드시 loading 상태를 반환
5. **에러 처리**: `console.error('한글 설명:', err)` 형식, UI 알림은 `useToast` 사용

## 검증

```bash
npm run build  # 빌드 에러 없는지 확인
npm run lint   # ESLint 통과 확인
```
