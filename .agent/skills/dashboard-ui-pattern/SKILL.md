---
name: dashboard-ui-pattern
description: 대시보드 및 통계 차트 컴포넌트 추가 시 준수해야 할 UI 레이아웃, 컬러 통일성 및 필터 컨트롤 패턴
---

# Dashboard & Chart UI Pattern Guide

차량운행일지 대시보드 영역의 일관된 사용자 경험(UX)과 심미성을 높이기 위한 UI 디자인/개발 가이드입니다. 통계, 차트, 데이터 시각화 컴포넌트를 추가하거나 수정할 때 반드시 이 패턴을 따르십시오.

## 1. 컴포넌트 구조 분류
대시보드 페이지 구성은 다음 3개의 핵심 계층으로 모듈화되어야 합니다.
- **`DashboardPage.tsx`**: 전체 레이아웃 (Overview, Analysis, Experience 등 Tab 구조 관리) 파사드
- **`ReportCharts.tsx` 등 위젯 컨테이너**: 특정 목적의 차트 그룹화 및 데이터 패칭 제어
- **`[Name]Chart.tsx`**: 순수 표시용(프리젠테이셔널) 차트 컴포넌트 (Recharts 래퍼)

## 2. 디자인 일관성 (컬러와 툴팁)
### 차량 컬러 연동
*   사용자 차량의 고유 색상이 지정되어 있다면, 차트 범례와 막대(또는 선)에 해당 색상을 매핑하십시오. (`vehicle-color` 스킬 문서 참조)
*   지정 색상이 없다면, CSS/Tailwind에 정의된 브랜드 기본 팔레트(`primary`, `secondary`)를 사용합니다.

### Recharts 툴팁 포맷
*   차트에서 특정 막대/선을 호버할 때 나타나는 Tooltip에는 **모든 관련 Metric이 표시되도록** 구성하세요.
*   단위(예: km, 회, 원) 포맷터(Formatter)를 반드시 지정합니다.

```tsx
<Tooltip 
  formatter={(value: number, name: string) => {
    if (name === 'distance') return [`${value.toLocaleString()} km`, '주행거리'];
    if (name === 'count') return [`${value} 회`, '운행횟수'];
    if (name === 'charge') return [`${value.toLocaleString()} 원`, '하이패스 결제액'];
    return [value, name];
  }}
/>
```

## 3. 필터 및 컨트롤러 위치
*   **기간 필터 / 부서 필터**: 대시보드의 위젯(카드) 상단 우측 영역에 버튼 트리거 또는 드롭다운으로 배치합니다.
*   **데이터 필터링**: 필터 로직은 프리젠테이셔널 차트 컨테이너가 아니라, 데이터를 Fetch하거나 Caching하는 상위 단위 컨트롤러(`stats` 커스텀 훅 등)에서 처리합니다.

## 4. 성능 최적화 (Premium 경험)
*   부드러운 애니메이션: Recharts의 애니메이션 기능을 끄지 마십시오. (단, 렌더링 부하가 큰 경우 최우선으로 개선)
*   Glassmorphism/다크모드: 위젯의 배경은 테마 시스템을 따르며, 다크 모드 시 글씨색과 대비(Contrast) 문제가 없는지 확인해야 합니다.
