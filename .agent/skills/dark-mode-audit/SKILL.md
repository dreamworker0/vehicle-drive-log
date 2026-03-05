---
name: dark-mode-audit
description: 기존 컴포넌트의 다크 모드 누락을 체계적으로 점검하고 수정하는 가이드
---

# 다크 모드 점검 스킬

기존 컴포넌트에서 `dark:` 변형이 빠진 곳을 찾아 수정하는 체계적 절차.

---

## 1. 자동 스캔 — 누락 후보 찾기

아래 패턴은 다크 모드 대응이 빠졌을 가능성이 높은 인라인 색상들이다.

### 1.1 배경색 누락
```bash
# bg-{color}-50~100 이 있는데 dark: 가 없는 줄 찾기
grep -rnE "bg-(green|blue|red|amber|orange|purple|emerald)-[0-9]+" src/components/ | grep -v "dark:"
```

### 1.2 텍스트 색상 누락
```bash
# text-surface-{500~900} 이 있는데 dark: 가 없는 줄 찾기
grep -rnE "text-surface-(5|6|7|8|9)00" src/components/ | grep -v "dark:"
```

### 1.3 보더 색상 누락
```bash
# border-{color}-100~200 이 있는데 dark: 가 없는 줄 찾기
grep -rnE "border-(green|blue|red|amber|surface)-[12]00" src/components/ | grep -v "dark:"
```

> **주의**: 위 결과 중 공통 클래스(`glass-card`, `btn-*`, `badge-*`, `input`) 내부에서 사용되는 것은 이미 다크 모드가 적용되어 있으므로 무시한다.

---

## 2. 수동 확인 — 우선순위별 체크

결과가 많을 경우 아래 우선순위 순서로 확인한다:

| 우선순위 | 대상 | 이유 |
|---------|------|------|
| 🔴 높음 | 큰 숫자, 제목, 데이터 값 | 사용자에게 가장 먼저 보이는 정보 |
| 🟡 중간 | 카드 배경, 배지, 알림 배너 | 밝은 배경이 다크 모드에서 눈에 띄게 어색함 |
| 🟢 낮음 | 보조 텍스트, 힌트, 구분선 | 시각적 영향이 상대적으로 작음 |

---

## 3. 수정 패턴 — 매핑표

`design-system.md`의 "다크 모드 필수 규칙" 매핑표를 기준으로 수정한다:

| 라이트 모드 | 다크 모드 페어링 |
|-------------|------------------|
| `text-surface-900` | `dark:text-surface-100` |
| `text-surface-700` | `dark:text-surface-300` |
| `text-surface-600` | `dark:text-surface-300` |
| `text-surface-500` | `dark:text-surface-400` |
| `bg-surface-50` | `dark:bg-surface-800` |
| `bg-{color}-50` | `dark:bg-{color}-900/20~30` |
| `border-{color}-100~200` | `dark:border-{color}-800/40~50` |
| `text-{color}-600~700` | `dark:text-{color}-400` |
| `bg-{color}-100` | `dark:bg-{color}-900/50` |

---

## 3-1. 배지(Badge)는 공통 클래스 우선 사용

> **핵심 원칙**: 배지에 `bg-red-100 text-red-700` 같은 인라인 색상을 넣으면 `dark:` 변형을 빼먹기 쉽다. `index.css`에 정의된 **`badge-*` 클래스**를 우선 사용한다.

### 사용 가능한 Badge 클래스

| 클래스 | 라이트 | 다크 |
|--------|--------|------|
| `badge-primary` | bg-primary-100, text-primary-700 | bg-primary-900/40, text-primary-300 |
| `badge-success` | bg-accent-100, text-accent-700 | bg-accent-900/40, text-accent-300 |
| `badge-warning` | bg-amber-100, text-amber-700 | bg-amber-900/40, text-amber-300 |
| `badge-danger` | bg-red-100, text-red-700 | bg-red-900/40, text-red-300 |
| `badge-neutral` | bg-surface-100, text-surface-600 | bg-surface-700, text-surface-400 |

### 점검 시 교체 패턴

```jsx
// ❌ 인라인 배지 — dark: 누락 위험
<span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">삭제됨</span>

// ✅ 공통 클래스 — 다크 모드 자동 적용
<span className="badge-danger">삭제됨</span>
```

> **참고**: `badge-*` 클래스에 크기나 여백 커스터마이징이 필요하면 추가 클래스를 병행한다 (예: `badge-danger text-[10px] ml-2`).

---

## 4. 검증

1. 개발 서버에서 다크/라이트 모드를 전환하며 수정된 화면을 확인
2. 특히 카드 내부 텍스트의 **대비**가 충분한지 확인
3. `npm run build`로 빌드 에러 없는지 확인

---

## 5. 버튼 다크 모드 — Soft 버튼 클래스 사용 규칙

> **핵심 원칙**: 버튼에 커스텀 색상(예: `bg-primary-50 text-primary-600`)을 인라인으로 넣으면 `dark:` 변형을 빼먹기 쉽다. 반드시 `index.css`에 정의된 **`btn-soft-*` 클래스**를 사용한다.

### 사용 가능한 Soft 버튼 클래스

| 클래스 | 라이트 | 다크 |
|--------|--------|------|
| `btn-soft-primary` | bg-primary-50, text-primary-600 | bg-primary-900/30, text-primary-400 |
| `btn-soft-blue` | bg-blue-50, text-blue-600 | bg-blue-900/30, text-blue-400 |
| `btn-soft-amber` | bg-amber-50, text-amber-600 | bg-amber-900/30, text-amber-400 |
| `btn-soft-red` | bg-red-50, text-red-600 | bg-red-900/30, text-red-400 |

### 사용 예시

```jsx
// ✅ 올바른 사용법 — 다크 모드 자동 적용
<button className="btn-soft-primary text-sm">이어서 기록</button>
<button className="btn-soft-amber w-full mt-2 text-sm">결재 요청</button>

// ❌ 잘못된 사용법 — dark: 빠뜨릴 위험
<button className="btn bg-primary-50 text-primary-600 hover:bg-primary-100">이어서 기록</button>
```

### 새 색상이 필요한 경우

1. `index.css`의 `@layer components` 안에 `.btn-soft-{color}` 클래스를 추가
2. 반드시 `dark:bg-{color}-900/30 dark:text-{color}-400 dark:hover:bg-{color}-900/50` 패턴을 포함
3. 인라인으로 색상을 직접 작성하지 말 것
