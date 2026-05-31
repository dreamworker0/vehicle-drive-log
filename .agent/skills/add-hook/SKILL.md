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
| `useToast` | 토스트 알림 표시 (전역 Context) | `hooks/useToast.ts` |
| `useConfirm` | 확인/취소 모달 호출 및 제어 (전역) | `hooks/useConfirm.ts` |
| `useTheme` | 라이트/다크 테마 설정 관리 | `hooks/useTheme.ts` |
| `useFontSize` | 화면 글자 크기 조절 (접근성 설정) | `hooks/useFontSize.ts` |
| `useForceLightMode` | 랜딩 및 인증 화면 강제 라이트 모드 | `hooks/useForceLightMode.ts` |
| `useOrientationLock` | 화면 회전 잠금 제어 (PDF 가로 모드) | `hooks/useOrientationLock.ts` |
| `useBackButton` | 모바일 웹 브라우저 뒤로가기 제어 | `hooks/useBackButton.ts` |
| `useAdminBadges` | 관리자 사이드바 미승인 건수 배지 실시간 구독 | `hooks/useAdminBadges.ts` |
| `useTodayDashboard` | 오늘 하루 차량 예약 현황 및 즉시 운행 조회 | `hooks/useTodayDashboard.ts` |
| `useReservationCalendar` | 예약 캘린더 뷰 제어 및 조작 | `hooks/useReservationCalendar.ts` |
| `useDriveLogForm` | 운행일지 기록 폼의 유효성 검사 및 상태 | `hooks/useDriveLogForm.ts` |
| `useDriveLogList` | 운행일지 리스트 필터링, 검색 및 조회 | `hooks/useDriveLogList.ts` |
| `useDriveLogOcr` | 계기판 사진 OCR 텍스트 인식 처리 | `hooks/useDriveLogOcr.ts` |
| `useMonthlyReport` | 월간 차량 운행/정비 보고서 생성 데이터 | `hooks/useMonthlyReport.ts` |
| `useAnalytics` | 통계 및 분석 대시보드 데이터 조회 | `hooks/useAnalytics.ts` |
| `useVehicleManager` | 차량 목록 등록/수정/삭제 CRUD | `hooks/useVehicleManager.ts` |
| `useVehicleHistory` | 차량별 상세 운행 및 정비 이력 타임라인 조회 | `hooks/useVehicleHistory.ts` |
| `useEmployeeManager` | 직원 목록 조회, 승인/반려/삭제 관리 | `hooks/useEmployeeManager.ts` |
| `useMaintenanceLog` | 차량 정비 기록 작성, 목록 조회 및 알림 | `hooks/useMaintenanceLog.ts` |
| `useSettings` | 기관 전체 설정 및 환경 설정 관리 | `hooks/useSettings.ts` |
| `useNotification` | FCM 알림 권한 획득 및 수신 관리 | `hooks/useNotification.ts` |
| `useOrgApplication` | 기관 신규 가입 신청서 폼 상태 관리 | `hooks/useOrgApplication.ts` |
| `useQuickDriveStart` | 예약 없이 운행 바로 시작하기 기능 | `hooks/useQuickDriveStart.ts` |
| `usePoiSearch` | Tmap API 연동 목적지(POI) 검색 및 기록 | `hooks/usePoiSearch.ts` |
| `useReservationPattern` | 요일/시간대별 단골 예약 패턴 제어 | `hooks/useReservationPattern.ts` |
| `useTimelineDrag` | 예약 타임라인 그리드에서의 드래그 앤 드롭 | `hooks/useTimelineDrag.ts` |
| `useFeedbackManagement` | 사용자 피드백 목록 조회 및 답변 작성/관리 | `hooks/useFeedbackManagement.ts` |
| `useDailyLog` | 특정 일자의 일일 운행기록 조회 및 관리 | `hooks/useDailyLog.ts` |
| `useFuelLog` | 직원/관리자 공용 주유 기록 관리 | `hooks/useFuelLog.ts` |
| `useFuelLogAdmin` | 관리자용 전체 주유 기록 목록 조회/내보내기 | `hooks/useFuelLogAdmin.ts` |
| `useHipassCharge` | 하이패스 충전 기록 조회 및 작성 | `hooks/useHipassCharge.ts` |
| `useHipassChargeAdmin` | 관리자용 하이패스 충전 기록 관리 및 조회 | `hooks/useHipassChargeAdmin.ts` |
| `useHipassManager` | 하이패스 단말기 및 카드 등록 CRUD | `hooks/useHipassManager.ts` |
| `useVehiclePriority` | 배차 시 선호 차량 및 정렬 우선순위 설정 | `hooks/useVehiclePriority.ts` |
| `useRetry` | 비동기 요청 실패 시 점진적 재시도 | `hooks/useRetry.ts` |
| `useServiceDashboard` | 종합 서비스 대시보드 데이터 연동 | `hooks/useServiceDashboard.ts` |

### 도메인별 세부 훅 (`hooks/{domain}/`)

더 복잡한 도메인은 하위 디렉터리 내에 독립된 기능별 훅으로 관리한다.

| 훅 | 역할 | 위치 |
|---|---|---|
| `useBaseFuelLog` | 주유 기록 CRUD 공통 베이스 로직 | `hooks/base/useBaseFuelLog.ts` |
| `useBaseHipassCharge` | 하이패스 충전 CRUD 공통 베이스 로직 | `hooks/base/useBaseHipassCharge.ts` |
| `useDriveLogInitializer` | 운행일지 폼 진입 시 초기값 및 이전 주행거리 조회 | `hooks/driveLogForm/useDriveLogInitializer.ts` |
| `useDriveLogSubmit` | 운행일지 실제 제출 처리 및 유효성 검사 | `hooks/driveLogForm/useDriveLogSubmit.ts` |
| `useDriveLogExport` | 운행일지 목록 엑셀 내보내기 | `hooks/driveLogList/useDriveLogExport.ts` |
| `useReservationData` | 예약 데이터 실시간 구독 및 캐싱 | `hooks/reservationCalendar/useReservationData.ts` |
| `useReservationForm` | 예약 신청/수정 폼의 유효성 검사 및 상태 관리 | `hooks/reservationCalendar/useReservationForm.ts` |
| `useRouteInfo` | 예약 경로 정보 및 Tmap 거리 계산 | `hooks/reservationCalendar/useRouteInfo.ts` |

### 훅 유틸리티 (`hooks/utils/`)

순수 함수는 훅이 아닌 `hooks/utils/`에 배치:

| 파일 | 역할 |
|------|------|
| `aggregationUtils.ts` | 주유/하이패스 등 통계 집계 유틸리티 |
| `analyticsCalc.ts` | 차량별, 부서별 운행 분석 계산 |
| `driveLogValidation.ts` | 운행일지 주행거리/주유량 유효성 검증 |
| `monthlyReportCalc.ts` | 월간 차량별 보고서 수치 집계 계산 |
| `recurringUtils.ts` | 반복 예약 일정 생성 및 관리 유틸리티 |
| `reservationPatternCalc.ts` | 사용자의 예약 패턴 분석 계산 |
| `reservationUtils.ts` | 예약 가능 여부, 충돌 검사 등 예약 비즈니스 헬퍼 |

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
