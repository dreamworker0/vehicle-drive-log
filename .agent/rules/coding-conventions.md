---
description: 차량 운행일지 앱 코딩 컨벤션 및 에이전트 행동 규칙. 코드를 작성하거나 수정할 때 반드시 따른다.
---

# 🤖 코딩 컨벤션 & 에이전트 규칙

차량 운행일지 앱의 코드를 작성·수정할 때 따르는 규칙. `scripts/gemini-pr-review.ts`의 ALWAYS_RULES라 **모든 PR 리뷰 프롬프트에 항상 주입**된다.

> **이 문서의 원칙** — 파일 목록·디렉터리 트리를 여기에 적지 않는다. "어디를 보라"까지만 적고 "무엇이 있나"는 코드가 답한다. 목록은 반드시 낡고, 낡은 목록은 리뷰마다 틀린 전제를 주입한다.

---

## 1. 파일 위치 결정

디렉터리별 역할은 [CLAUDE.md](../../CLAUDE.md)의 '디렉토리 컨벤션' 절이 단일 원본이다. 새 파일의 위치는 다음 기준으로 정한다.

| 무엇을 추가하나 | 어디에 |
|---|---|
| 역할 전용 화면 | `src/components/` 아래 역할 디렉터리 — 역할 경계를 넘지 않는다 |
| 2개 이상 역할이 쓰는 컴포넌트 | `src/components/common/` |
| 데이터 접근 함수 | `src/lib/firestore/`의 해당 도메인 파일 (§3.1) |
| Firestore 문서 필드 | `src/schemas/` (Zod 단일 원본) — `src/types/`에서 문서 인터페이스를 새로 선언하지 않는다 |
| 커스텀 훅 | `src/hooks/` |
| 외부 API 연동 | `src/lib/`에 별도 파일 |
| 전역 UI 상태 | `src/store/` (Zustand) |

> ✅ 새 훅·컴포넌트를 만들기 전에 **기존과 역할이 겹치지 않는지** 먼저 확인한다. 훅이 많아 중복 생성이 흔하다 — 목록은 `src/hooks/` 디렉터리가 답한다.

> ⚠️ 렌더 진입점은 `src/main.tsx`가 인증 여부로 `src/appEntry.tsx`(로그인)와 `src/lightEntry.tsx`(비로그인)로 분기한다. 라우팅 가드·프로바이더 같은 **횡단 관심사는 반드시 양쪽 모두**에 반영한다 — 한쪽만 고치면 비로그인 경로에서 조용히 빠진다.

---

## 2. 컴포넌트 작성 규칙

### 2.1 함수 선언형 default export

컴포넌트는 `export default function ComponentName() { ... }` 형태로 선언한다. 화살표 함수를 변수에 담아 `export default`하는 형태는 지양한다 (`memo`·`forwardRef` 래핑은 예외).

순서 — 파일: import → 상수 → 헬퍼 함수 → 메인 컴포넌트 → 보조 컴포넌트. 컴포넌트 내부: 훅 → 파생 상태(`useMemo`) → 이벤트 핸들러 → 로딩 early return → JSX.

### 2.2 상태 관리

- **인증·사용자 정보**: `useAuth` (React Context)
- **전역 UI 상태**(토스트·확인 모달·테마·글자 크기): `src/store/`의 Zustand 스토어. **도메인 데이터는 Zustand에 넣지 않는다.**
- **서버 데이터**: `src/hooks/`의 커스텀 훅이 `src/lib/firestore` 함수를 호출해 로드한다 (`useEffect` + `useState`가 기본). 컴포넌트는 렌더링에 집중하고 로딩·변환 로직은 훅에 위임한다.
- **로컬 상태**: `useState`
- **실시간 구독**: `onSnapshot`을 쓰면 `useEffect`에서 반드시 unsubscribe를 cleanup으로 반환한다.

---

## 3. Firestore 사용 패턴

### 3.1 CRUD 함수는 `src/lib/firestore/` 도메인별 파일에 집중

```ts
// ✅ 도메인 파일에서 export → index.ts에서 re-export → 컴포넌트는 index에서 import
import { getVehicles, createReservation } from '../../lib/firestore';

// ❌ 컴포넌트에서 직접 Firestore 호출 — "한 건만 읽으니까"도 예외가 아니다
```

### 3.2 데이터 비정규화

`driveLogs`에 `driverName`·`vehicleDisplayName`, `reservations`에 `reservedByName`·`vehicleName`을 저장해 JOIN을 피한다. 비정규화된 필드는 **원본 변경 시 함께 업데이트**한다.

### 3.3 조직 격리

- **모든 쿼리**에 `organizationId` 조건을 포함하고, 함수 첫 파라미터로 `orgId`를 받는다.
- **정적 강제**: tenant-scoped 도메인 파일은 커스텀 ESLint 규칙 `local/require-organization-filter`(→ [eslint-rules/require-organization-filter.js](../../eslint-rules/require-organization-filter.js))가 `query()`가 속한 함수 본문에 `where('organizationId', ...)`가 없으면 CI lint 게이트에서 차단한다. **대상 파일 목록의 단일 원본은 `eslint.config.js`의 해당 `files` 글롭**이다.
- 전역 도메인(기관·사용자·알림 등)은 조직 격리 대상이 아니라 규칙에서 제외된다. 의도된 전역 쿼리는 `// eslint-disable-next-line local/require-organization-filter -- <사유>`로 예외 처리한다.

### 3.4 에러 처리

```ts
try {
    await someFirestoreOp();
} catch (err) {
    console.error('한글 설명:', err);   // 로깅은 한글 설명 + err
    showToast('사용자 친화적 에러 메시지', 'error');
}
```

---

## 4. 네이밍 컨벤션

| 대상 | 규칙 | 예시 |
|------|------|------|
| 컴포넌트 파일·함수 | PascalCase | `TodayDashboard.tsx` / `function TodayDashboard()` |
| 이벤트 핸들러 | `handle` + 동사 | `handleStartDrive`, `handleSubmit` |
| 상태 setter | `set` + 변수명 | `setLoading`, `setVehicles` |
| 상수 | UPPER_SNAKE_CASE | `VEHICLE_COLORS`, `VEHICLE_TYPE_ICONS` |
| Firestore 함수 | 동사 + 명사 | `getVehicles`, `createReservation` |
| CSS 커스텀 클래스 | kebab-case | `glass-card`, `btn-primary` |
| 주석 | 한글, 용도 설명 | `// 운행 시작 (예약에서)` |

---

## 5. 사용자 상호작용

### 5.1 확인 다이얼로그 — `useConfirm`

```tsx
import { useConfirm } from '../../hooks/useConfirm';

const { confirm } = useConfirm();
const ok = await confirm({ message: '정말 삭제하시겠습니까?', confirmColor: 'danger' });
if (!ok) return;
```

옵션(`title`·`confirmText`·`confirmColor`, 텍스트 입력용 `type: 'input'` 등)의 단일 원본은 `src/store/useConfirmStore.ts`의 `ConfirmOptions`다.

> ⛔ **`window.confirm()`·`window.alert()`·`window.prompt()` 절대 사용 금지** — ESLint `no-restricted-globals`로 차단된다.
> 확인/취소 → `useConfirm().confirm()` · 알림 → `useToast().showToast()` · 텍스트 입력 → `confirm({ type: 'input' })` 또는 별도 폼 UI.

### 5.2 알림/토스트 — `useToast`

- 컴포넌트: `src/hooks/useToast.ts`의 `useToast().showToast(message, type)` — type은 `'info' | 'success' | 'warning' | 'error'`.
- 비-React 모듈: `src/lib/notify.ts`의 `notifyUser`.
- `alert()`·react-hot-toast 금지 (패키지 제거됨).

---

## 6. 차량 표시 상수

차량 아이콘·색상은 `src/lib/constants.ts`에서 import하고 직접 재정의하지 않는다. 사용 규칙은 [vehicle-color 스킬](../skills/vehicle-color/SKILL.md), 시각 규격은 [design-system §5](design-system.md)가 단일 원본이다.

---

## 7. 기술 스택 제약사항

- **React 19**: 함수 컴포넌트 + Hooks만 사용 (클래스 컴포넌트 금지).
- **TypeScript**: `any` 금지. 구체 타입을 정의하거나 `unknown` + 타입 가드로 처리한다 (`@typescript-eslint/no-explicit-any` 경고 제로 유지).
- **TailwindCSS v4**: CSS 기반 설정 (`@import "tailwindcss"`, `@theme`, `@custom-variant`). `@apply`·`@layer`도 사용 가능. **v3식 `tailwind.config.js` 신설 금지** — 설정은 `src/index.css`의 `@theme`로 관리한다.
- **라우팅**: React Router v7 (`Routes`, `Route`, `NavLink`, `useNavigate`, `useLocation`).
- **Firebase**: v9+ Modular SDK (`import { ... } from 'firebase/firestore'`).
- **빌드**: Vite 7 (HMR, ESM).
- **Node.js**: v22 고정 (루트·Functions 공통). Functions의 모듈 시스템·배포 규칙은 [cloud-functions.md](cloud-functions.md)가 단일 원본이다.

---

## 8. 코드 품질 규칙

1. **불필요한 의존성 금지** — 이미 쓰는 라이브러리로 해결되면 새 패키지를 추가하지 않는다.
2. **커밋 메시지** — Conventional Commits 형식(commitlint가 강제) + 한국어 본문(관례).
3. **console.error에 한글 설명 포함** — `console.error('로드 실패:', err)`.
4. **JSX 중복 최소화** — 반복 UI는 함수나 서브 컴포넌트로 추출한다.
5. **하드코딩 금지** — 매직 넘버·반복되는 문자열(연락처 이메일 등)은 상수로 뺀다. 역할 문자열은 상수 대신 `src/schemas/user.ts`에서 파생된 `UserRole` 타입으로 좁힌다.
6. **외부 API 호출 절약** — TMap 등은 `429` 방지와 비용 절감을 위해 캐싱(localStorage·인메모리)이나 큐 패턴으로 호출을 최소화한다.
