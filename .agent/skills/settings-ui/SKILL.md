---
name: settings-ui
description: 설정 페이지의 디자인 패턴을 정의하여 새 설정 항목 추가 시 통일된 UI를 유지하는 가이드
---

# 설정 페이지 디자인 통일 스킬

설정 페이지(`Settings.jsx`)에 새 섹션이나 항목을 추가할 때 반드시 따라야 하는 디자인 패턴.

---

## 1. 전체 구조

설정 페이지는 **섹션 그룹 → 카드 → 항목** 3단 계층으로 구성된다.

```
Settings
├── 섹션 그룹 헤더 ("기관 관리")
│   ├── 카드: 기관 정보 (폼 카드)
│   ├── 카드: 결재 라인 (폼 카드)
│   ├── 카드: 공휴일 관리 (HolidayManager)
│   └── 카드: 기관 식별 정보 (읽기전용 카드)
├── 섹션 그룹 헤더 ("내 계정")
│   └── 카드: 로그인 정보 + 푸시 알림 (리스트 카드)
└── 섹션 그룹 헤더 ("앱 정보")
    └── 카드: 사용 설명서 + 의견남기기 (리스트 카드)
```

---

## 2. 섹션 그룹 헤더

섹션 그룹을 구분하는 소제목. 첫 번째 그룹을 제외하고 `mt-8`로 상단 여백 추가.

```jsx
{/* 첫 번째 그룹 — mt 없음 */}
<h2 className="text-sm font-semibold text-surface-400 dark:text-surface-500 uppercase tracking-wider mb-3 px-1">
    기관 관리
</h2>

{/* 두 번째 이후 그룹 — mt-8 추가 */}
<h2 className="text-sm font-semibold text-surface-400 dark:text-surface-500 uppercase tracking-wider mt-8 mb-3 px-1">
    내 계정
</h2>
```

**핵심 규칙:**
- `text-sm font-semibold uppercase tracking-wider`
- 색상: `text-surface-400 dark:text-surface-500`
- 간격: 첫 그룹 `mb-3 px-1`, 이후 `mt-8 mb-3 px-1`

---

## 3. 카드 컨테이너

모든 설정 카드는 `glass-card` 클래스를 사용한다.

```jsx
<div className="glass-card p-6 mb-6">
    <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-4">카드 제목</h2>
    {/* 내용 */}
</div>
```

**핵심 규칙:**
- 래퍼: `glass-card p-6 mb-6` (마지막 카드는 `mb-6` 생략 가능)
- 카드 제목: `text-lg font-semibold text-surface-900 dark:text-surface-100 mb-4`
- 부가 설명: `<p className="text-xs text-surface-400 mb-4">설명 텍스트</p>`

---

## 4. 카드 유형별 패턴

### 4-1. 폼 카드 — 입력 필드 + 저장 버튼

기관 정보, 결재 라인처럼 값을 편집하고 저장하는 카드.

```jsx
<div className="glass-card p-6 mb-6">
    <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-4">카드 제목</h2>
    <form onSubmit={handleSave} className="space-y-4">
        <div>
            <label className="label">필드명</label>
            <input type="text" value={value} onChange={...} className="input" required />
        </div>
        {/* 추가 필드 */}
        <div className="flex justify-end">
            <button type="submit" disabled={saving} className="btn-primary">
                {saving ? (<><div className="w-4 h-4 spinner" />저장 중...</>) : '변경사항 저장'}
            </button>
        </div>
    </form>
</div>
```

### 4-2. 읽기전용 카드 — 정보 표시만

기관 식별 정보처럼 수정 불가능한 값을 나열하는 카드.

```jsx
<div className="glass-card p-6 mb-6">
    <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-4">카드 제목</h2>
    <div className="space-y-3 text-sm">
        <div className="flex justify-between items-center p-3 bg-surface-50 dark:bg-surface-800 rounded-xl">
            <span className="text-surface-500 dark:text-surface-400">레이블</span>
            <span className="text-surface-600 dark:text-surface-300">값</span>
        </div>
        {/* 추가 행 */}
    </div>
</div>
```

**핵심 규칙:**
- 행 래퍼: `flex justify-between items-center p-3 bg-surface-50 dark:bg-surface-800 rounded-xl`
- 레이블: `text-surface-500 dark:text-surface-400`
- 값: `text-surface-600 dark:text-surface-300`
- 코드/ID 값: `font-mono text-xs` 추가

### 4-3. 리스트 카드 — 아이콘 + 텍스트 항목

내 계정, 앱 정보처럼 클릭 가능한 항목을 나열하는 카드.

```jsx
<div className="glass-card p-6 mb-6">
    {/* 항목 하나 */}
    <button
        onClick={handleClick}
        className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors text-left"
    >
        {/* 아이콘 원형 */}
        <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/40 rounded-full flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-blue-600" ...>...</svg>
        </div>
        {/* 텍스트 */}
        <div className="flex-1">
            <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">항목명</p>
            <p className="text-xs text-surface-400">설명 텍스트</p>
        </div>
        {/* 우측 화살표 (네비게이션 항목) */}
        <svg className="w-4 h-4 text-surface-300" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
        </svg>
    </button>

    {/* 항목 사이 구분선 */}
    <div className="border-t border-surface-100 dark:border-surface-700 my-3" />

    {/* 다음 항목 */}
</div>
```

**핵심 규칙:**
- 항목 버튼: `w-full flex items-center gap-3 p-3 rounded-xl hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors text-left`
- 아이콘 원형: `w-10 h-10 bg-{color}-100 dark:bg-{color}-900/40 rounded-full flex items-center justify-center flex-shrink-0`
- 아이콘 SVG: `w-5 h-5 text-{color}-600`
- 항목 제목: `text-sm font-semibold text-surface-900 dark:text-surface-100`
- 항목 설명: `text-xs text-surface-400`
- 구분선: `border-t border-surface-100 dark:border-surface-700 my-3` (또는 `my-1 mx-3`)
- 네비게이션 화살표: `w-4 h-4 text-surface-300`

---

## 5. 우측 액세서리 유형

리스트 항목의 오른쪽에 올 수 있는 요소들:

| 유형 | 패턴 | 예시 |
|------|------|------|
| 네비게이션 화살표 | `<svg className="w-4 h-4 text-surface-300">` | 사용 설명서, 의견남기기 |
| 상태 배지 | `badge-*` 클래스 | 푸시 알림 켜짐/꺼짐 |
| 액션 버튼 | 인라인 버튼 (예: 로그아웃) | 로그아웃 |
| 토글 스위치 | 커스텀 toggle | 향후 확장용 |

### 상태 배지 예시

```jsx
{/* 활성화 유도 */}
<span className="text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2.5 py-1 rounded-full">활성화</span>

{/* 켜짐 */}
<span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-2.5 py-1 rounded-full">켜짐</span>

{/* 꺼짐 */}
<span className="text-xs font-medium text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/30 px-2.5 py-1 rounded-full">꺼짐</span>
```

---

## 6. 섹션 순서 규칙

현재 설정 페이지의 확정된 섹션 순서:

1. **기관 관리** (섹션 그룹)
   1. 기관 정보 (폼 카드)
   2. 결재 라인 (폼 카드)
   3. 공휴일 관리 (HolidayManager)
   4. 기관 식별 정보 (읽기전용 카드)
2. **내 계정** (섹션 그룹)
   1. 로그인 정보 + 푸시 알림 (리스트 카드)
3. **앱 정보** (섹션 그룹)
   1. 사용 설명서 + 의견남기기 (리스트 카드)

새 항목을 추가할 때는 **가장 관련 높은 섹션 그룹 내**에 배치한다.

---

## 7. 새 설정 항목 추가 절차

### 7-1. 기존 카드에 항목 추가

1. 해당 카드를 찾아 구분선 + 새 항목 추가
2. 리스트 카드라면 아이콘 원형 색상은 기존 항목과 겹치지 않게 선택
3. 우측 액세서리는 항목 성격에 맞는 유형 사용

### 7-2. 새 카드 추가

1. 카드 유형 결정 (폼 / 읽기전용 / 리스트)
2. 적절한 섹션 그룹 내에 배치
3. `glass-card p-6 mb-6` 래퍼 사용
4. 카드 제목 스타일 통일

### 7-3. 새 섹션 그룹 추가

1. 기존 그룹에 맞지 않는 완전히 새로운 카테고리인 경우에만 추가
2. 섹션 그룹 헤더에 `mt-8` 포함
3. 섹션 순서는 사용 빈도와 중요도를 고려하여 배치

---

## 8. 로직 분리 규칙

- **상태/로직**: `useSettings` 훅에 추가 (`src/hooks/useSettings.js`)
- **UI만**: `Settings.jsx`에 작성
- **복잡한 서브 UI**: 별도 컴포넌트로 분리 (예: `HolidayManager`)
  - `admin/` 폴더에 배치, Settings에서 import하여 사용

---

## 9. 검증

1. 다크 모드: 라이트/다크 전환 시 모든 텍스트·배경·보더 색상 확인
2. 반응형: 모바일 화면에서 카드 내부 레이아웃 깨짐 없는지 확인
3. 빌드: `npm run build` 에러 없는지 확인
