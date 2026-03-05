---
description: 차량 운행일지 앱 디자인 시스템 규칙. 새 컴포넌트를 만들거나, 기존 UI를 수정할 때 반드시 참고한다.
---

# 🎨 디자인 시스템

이 문서는 차량 운행일지 앱의 **디자인 일관성**을 유지하기 위한 규칙이다.
새 컴포넌트를 만들거나 기존 UI를 수정할 때 반드시 따른다.

---

## 1. 색상 팔레트

> `tailwind.config.js`에 정의된 커스텀 색상만 사용한다. Tailwind 기본 `blue`, `green`, `slate` 등을 직접 쓰지 않는다.

| 토큰 | 용도 | 실제 색상 |
|------|------|-----------|
| `primary-*` | 브랜드 색상, 주요 버튼, 활성 상태, 링크 | Blue 계열 (`#2563eb` 기준) |
| `accent-*` | 성공, 긍정적 상태, 승인 | Green 계열 (`#16a34a` 기준) |
| `surface-*` | 배경, 텍스트, 보더, 비활성 상태 | Slate 계열 (`#f8fafc` ~ `#0f172a`) |
| `red-*` | 위험, 삭제, 에러 | Tailwind red (허용 예외) |
| `amber-*` | 경고, 운행 중 상태 | Tailwind amber (허용 예외) |

### 주요 사용 패턴
- **배경**: `bg-surface-50` (앱 전체), `bg-white` (카드, 사이드바)
- **텍스트**: `text-surface-900` (제목), `text-surface-700` (본문), `text-surface-500` (보조), `text-surface-400` (비활성/힌트)
- **보더**: `border-surface-100` (구분선), `border-surface-200` (인풋/카드)
- **아이콘 배경**: `bg-primary-100 text-primary-600` (기본), `bg-accent-50 text-accent-600` (성공), `bg-amber-50 text-amber-600` (경고)

### 다크 모드 필수 규칙

> **인라인으로 색상을 지정할 때는 반드시 `dark:` 변형을 함께 작성한다.**
> 공통 클래스(`glass-card`, `btn-*`, `badge-*`, `input` 등)는 이미 다크 모드가 포함되어 있으므로 추가 불필요.

| 라이트 모드 | 다크 모드 페어링 | 용도 |
|-------------|------------------|------|
| `text-surface-900` | `dark:text-surface-100` | 제목 |
| `text-surface-700` | `dark:text-surface-300` | 본문 |
| `text-surface-600` | `dark:text-surface-300` | 데이터 값 |
| `text-surface-500` | `dark:text-surface-400` | 라벨, 보조 텍스트 |
| `bg-surface-50` | `dark:bg-surface-800` | 행/섹션 배경 |
| `bg-{color}-50` | `dark:bg-{color}-900/20~30` | 컬러 카드 배경 |
| `border-{color}-100~200` | `dark:border-{color}-800/40~50` | 컬러 카드 보더 |
| `text-{color}-600~700` | `dark:text-{color}-400` | 컬러 텍스트 (숫자, 배지) |
| `bg-{color}-100` | `dark:bg-{color}-900/50` | 컬러 배지 배경 |

**체크리스트**: 새 컴포넌트를 만들거나 인라인 색상을 추가할 때, 위 표를 참고하여 `dark:` 변형이 빠지지 않았는지 확인한다.

---

## 2. 타이포그래피

- **폰트**: Pretendard (한글 최적화), Inter (영문 폴백)
- **줄 높이**: Tailwind 기본 사용

| 용도 | 클래스 |
|------|--------|
| 페이지 제목 (관리자) | `text-2xl font-bold text-surface-900` |
| 페이지 제목 (직원) | `text-xl font-bold text-surface-900` |
| 섹션 제목 | `text-lg font-semibold text-surface-900` |
| 소제목/그룹 레이블 | `text-sm font-semibold text-surface-600` |
| 본문 | `text-sm text-surface-700` |
| 보조 텍스트 | `text-sm text-surface-500` 또는 `text-xs text-surface-400` |
| 날짜/시간 | `text-sm text-surface-400` |
| 숫자/데이터 | `font-mono` 추가 |

---

## 3. 컴포넌트 스타일

> `index.css`의 `@layer components`에 정의된 클래스를 **우선 사용**한다. 인라인 TailwindCSS보다 공통 클래스를 선호한다.

### 3.1 카드
```
glass-card     — 기본 카드: 흰 배경 + 블러 + 그림자 + rounded-2xl
glass-card p-5 — 일반 콘텐츠 카드 (padding 5)
glass-card p-4 — 콤팩트 카드 (예약 폼 등)
```
- **빈 상태 (Empty State)**: `glass-card p-8 text-center` + 아이콘(text-3xl~4xl) + 설명 텍스트
- **리스트 아이템**: `glass-card p-4 hover:shadow-glass-lg transition-all`

### 3.2 버튼
```
btn-primary    — 주요 액션 (파란색, 그림자)
btn-secondary  — 보조 액션 (회색 배경, 보더)
btn-danger     — 삭제/위험 (빨간색)
btn-success    — 승인/성공 (초록색)
btn-ghost      — 텍스트 버튼 (배경 없음)
btn-sm         — 작은 크기 수정자
btn-lg         — 큰 크기 수정자
btn-icon       — 아이콘 전용 (정사각형 패딩)
```
- **조합 예시**: `btn-primary btn-sm`, `btn-icon btn-ghost`
- **비활성**: `disabled:opacity-50 disabled:cursor-not-allowed`는 `btn` 베이스에 포함

### 3.3 인풋
```
input          — 기본 입력 필드 (w-full, rounded-xl, border)
input-error    — 에러 상태
label          — 폼 레이블 (text-sm font-medium text-surface-700 mb-1.5)
```
- **select**: `input` 클래스 동일 적용, 또는 커스텀 스타일
- **시간 입력**: `input text-sm px-2`

### 3.4 뱃지
```
badge-primary  — 기본 (파란색)
badge-success  — 성공 (초록색)
badge-warning  — 경고 (노란색)
badge-danger   — 위험 (빨간색)
badge-neutral  — 중립 (회색)
```

### 3.5 모달
```jsx
// 오버레이
<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
  // 모달 본체
  <div className="glass-card p-6 w-full max-w-md animate-scale-in">
    <h3 className="text-lg font-semibold text-surface-900 mb-4">제목</h3>
    ...
    <div className="flex gap-3 pt-2">
      <button className="btn-secondary flex-1">취소</button>
      <button className="btn-primary flex-1">확인</button>
    </div>
  </div>
</div>
```

---

## 4. 레이아웃

### 4.1 관리자 (PC 중심)
- 좌측 사이드바 (`w-64`, `bg-white`, `border-r`) + 우측 메인 콘텐츠
- 상단 헤더: `sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b h-14`
- 콘텐츠 영역: `p-4 lg:p-6`
- 콘텐츠 최대 폭: `max-w-4xl mx-auto`
- 사이드바 반응형: 모바일에서 오버레이로 전환 (`lg:static`, `-translate-x-full lg:translate-x-0`)

### 4.2 직원 (모바일 중심)
- 상단 헤더: `sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b h-14`
- 하단 탭 바: `fixed bottom-0 bg-white/90 backdrop-blur-md border-t h-16`
- 콘텐츠 영역: `p-4 pb-20` (하단 탭 바 여유 공간)
- 콘텐츠 최대 폭: `max-w-lg mx-auto`

### 4.3 그리드
- **통계 카드**: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4`
- **달력 + 사이드 패널**: `grid grid-cols-1 lg:grid-cols-3 gap-6` (달력 2칸, 패널 1칸)
- **차량 선택**: `grid grid-cols-3 gap-1.5`
- **시간 입력 2칸**: `grid grid-cols-2 gap-2`

---

## 5. 아이콘 규칙

- **라이브러리**: Heroicons (outline, strokeWidth 1.5)
- **사이드바/탭 아이콘**: `w-5 h-5` (사이드바), `w-6 h-6` (모바일 탭)
- **버튼 내 아이콘**: `w-4 h-4` (btn-sm), `w-5 h-5` (기본)
- **이모지**: 차량 타입 아이콘에만 사용 (🚗🚙🚐🚌), 빈 상태 장식 (📋📅 등)
- **아이콘 컨테이너**: 정사각형 배경 + rounded
  - 대: `w-12 h-12 rounded-xl` (대시보드 통계)
  - 중: `w-10 h-10 rounded-lg` (예약 카드)
  - 소: `w-8 h-8 rounded-lg` (헤더 로고)

### 차량 색상 시스템
```js
const VEHICLE_COLORS = [
    'bg-red-200', 'bg-blue-200', 'bg-yellow-200', 'bg-green-200', 'bg-purple-200',
    'bg-orange-300', 'bg-cyan-200', 'bg-pink-300', 'bg-indigo-300', 'bg-lime-300',
];
// 차량 ID를 해시하여 고유 색상을 배정한다
```
- 이 색상 배열과 해시 함수(`getVehicleColor`)는 차량을 표시하는 모든 곳에서 동일하게 사용한다.

---

## 6. 애니메이션 & 상호작용

### 6.1 Tailwind 커스텀 애니메이션 (tailwind.config.js)
| 클래스 | 용도 |
|--------|------|
| `animate-fade-in` | 페이지/섹션 진입 |
| `animate-slide-up` | 바닥에서 올라오는 요소 |
| `animate-slide-down` | 위에서 내려오는 요소 (에러 메시지) |
| `animate-scale-in` | 모달, 팝업 |
| `animate-pulse-soft` | 부드러운 강조 |

### 6.2 CSS 커스텀 애니메이션 (index.css)
- **운행 중 상태** 전용:
  - `driving-card` — 운행 중 카드 배경 (amber 그라데이션)
  - `driving-progress-bar` — 상단 주행 애니메이션 바
  - `driving-badge` — 운행 중 뱃지
  - `driving-dot` — 점멸 도트
  - `@keyframes carDrive` — 차 아이콘 흔들림
  - `@keyframes drivePulse` — 뱃지 펄스

### 6.3 인터랙션
- **버튼 클릭**: `active:scale-[0.98]` (btn 베이스에 포함)
- **카드 호버**: `hover:shadow-glass-lg transition-all`
- **목록 아이템 호버**: `hover:bg-surface-50` 또는 `hover:bg-surface-100`
- **링크 호버**: `hover:underline`
- **전환**: `transition-all duration-200`

---

## 7. 로딩 & 에러 상태

### 로딩 스피너
```jsx
// 전체 페이지 로딩
<div className="flex items-center justify-center py-20">
  <div className="w-8 h-8 spinner" />
</div>

// 버튼 내 로딩
<div className="w-4 h-4 spinner" /> // (btn-sm)
<div className="w-5 h-5 spinner" /> // (기본 버튼)
```

### 에러 메시지
```jsx
<div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600 animate-slide-down">
  에러 메시지
</div>
```

---

## 8. 반응형 규칙

| 브레이크포인트 | 대상 | 동작 |
|---------------|------|------|
| `< lg (1024px)` | 관리자 사이드바 | 숨김, 햄버거 메뉴로 토글 |
| `sm (640px)` | 통계 카드 | `grid-cols-1` → `grid-cols-2` |
| `lg (1024px)` | 통계 카드 | → `grid-cols-4` |
| `lg (1024px)` | 달력 레이아웃 | `grid-cols-1` → `grid-cols-3` |
| 모바일 전체 | 직원 화면 | 하단 탭 바 + 상단 헤더 |

- **모바일 줌 방지**: `input`, `select`, `textarea`는 `font-size: 16px`로 고정
- **Safe area**: `safe-top`, `safe-bottom` 유틸리티 사용 (노치 대응)

---

## 9. 차트 스타일 (Recharts)

> `recharts` 라이브러리를 사용할 때의 디자인 규칙이다. `AnalyticsDashboard`, `TrendCharts`, `CostOptimization`, `MonthlyReport` 등에서 공통 적용한다.

### 9.1 차트 색상

커스텀 색상 토큰과 일관되게 사용한다:

```js
const CHART_COLORS = {
    primary: '#2563eb',    // primary-600 — 주 데이터, 운행 건수 등
    accent: '#16a34a',     // accent-600 — 긍정 지표, 효율 등
    amber: '#d97706',      // amber-600 — 경고, 비용 등
    red: '#dc2626',        // red-600 — 위험, 이상치 등
    purple: '#9333ea',     // purple-600 — 보조 데이터
    surface: '#94a3b8',    // surface-400 — 비활성, 그리드 라인
};
```

### 9.2 차트 공통 설정

```jsx
<ResponsiveContainer width="100%" height={280}>
    <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
        <XAxis
            dataKey="name"
            tick={{ fontSize: 12, fill: 'var(--chart-text)' }}
        />
        <YAxis tick={{ fontSize: 12, fill: 'var(--chart-text)' }} />
        <Tooltip
            contentStyle={{
                backgroundColor: 'var(--chart-tooltip-bg)',
                border: '1px solid var(--chart-tooltip-border)',
                borderRadius: '12px',
                fontSize: '13px',
            }}
        />
    </BarChart>
</ResponsiveContainer>
```

### 9.3 다크 모드 대응

차트는 CSS 변수를 활용하여 다크 모드를 처리한다. `index.css`에 정의된 CSS 변수를 사용한다:

| CSS 변수 | 라이트 | 다크 | 용도 |
|----------|--------|------|------|
| `--chart-grid` | `#e2e8f0` | `#334155` | 그리드 라인 |
| `--chart-text` | `#64748b` | `#94a3b8` | 축 레이블 |
| `--chart-tooltip-bg` | `white` | `#1e293b` | 툴팁 배경 |
| `--chart-tooltip-border` | `#e2e8f0` | `#334155` | 툴팁 보더 |

### 9.4 차트 높이 규칙

| 컨텍스트 | 높이 |
|---------|------|
| 대시보드 메인 차트 | `280px` |
| 카드 내 소형 차트 | `200px` |
| 히트맵 / 분포 차트 | `320px` |
