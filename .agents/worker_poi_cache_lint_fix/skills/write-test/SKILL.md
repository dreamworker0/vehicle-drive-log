---
name: write-test
description: React 단위 테스트(Vitest) 및 E2E 테스트(Playwright) 작성 컨벤션과 Mocking 가이드
---

# 테스트 작성 가이드

## 테스트 구조

```
src/__tests__/            ← 프론트엔드 단위 테스트 (Vitest + jsdom)
├── setup.ts              ← @testing-library/jest-dom import
├── hooks/                ← 커스텀 훅 테스트 (22개)
├── lib/                  ← 유틸/라이브러리 테스트 (16개)
└── components/           ← 컴포넌트 렌더링 테스트

functions/src/__tests__/  ← Cloud Functions 테스트 (별도 vitest 설정)
├── emulator.setup.ts     ← Firebase Emulator 초기화
├── *.test.ts             ← 순수 단위 테스트
└── *.emulator.test.ts    ← Emulator 연동 테스트

e2e/                      ← E2E 테스트 (Playwright)
└── *.spec.ts             ← 12개 시나리오
```

## 1. 단위 테스트 (Vitest)

### 파일 위치 규칙

| 대상 | 위치 | 파일명 |
|------|------|--------|
| 커스텀 훅 | `src/__tests__/hooks/` | `useXxx.test.ts` |
| lib 유틸 | `src/__tests__/lib/` | `모듈명.test.ts` |
| 컴포넌트 | `src/__tests__/components/` | `ComponentName.test.tsx` |
| Cloud Function | `functions/src/__tests__/` | `함수명.test.ts` |

> ⚠️ 소스 파일 옆에 `.test.ts`를 두지 않는다. `__tests__/` 디렉터리에 통합 관리.

### Hook 테스트 패턴

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// External dependency mock — import보다 위에 선언
const mockShowToast = vi.fn();
vi.mock('../../hooks/useToast', () => ({
    useToast: () => ({ showToast: mockShowToast }),
}));

// Hook import는 vi.mock 뒤에
import useMyHook from '../../hooks/useMyHook';

describe('useMyHook', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('정상 케이스를 설명한다', async () => {
        const { result } = renderHook(() => useMyHook());

        await act(async () => {
            await result.current.doSomething();
        });

        expect(result.current.state).toBe('expected');
    });
});
```

### Firestore 및 Auth Mock 패턴

Firebase 모듈은 항상 mock 처리한다:

```ts
vi.mock('../../lib/firebase', () => ({
    db: {},
    auth: { currentUser: { uid: 'test-uid' } },
}));

// Vitest 로컬 실행 시 auth/invalid-api-key 에러를 방지하려면,
// 테스트 상단에 VITE_FIREBASE_API_KEY 환경변수나 Mock 초기화 코드가 필요할 수 있다.

vi.mock('firebase/firestore', () => ({
    collection: vi.fn(),
    doc: vi.fn(),
    getDocs: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    Timestamp: {
        now: () => ({ toDate: () => new Date() }),
        fromDate: (d: Date) => ({ toDate: () => d }),
    },
}));
```

### 상태 변경 부작용과 `act(...)` 래핑
- 컴포넌트 렌더링 테스트나 커스텀 훅 내에서 상태 변경(state update)이 일어나는 모든 이벤트(클릭, 타이핑)와 비동기 결과 처리는 **반드시** `@testing-library/react`의 `act(...)` 로 감싸야 한다.
- 그렇지 않을 경우 `Warning: An update to X inside a test was not wrapped in act(...)` 경고가 발생하며, 비동기 상태의 단언(assertion)이 실패할 수 .

### ⚠️ Mock 안티패턴 (반드시 회피)

#### 함정 1: 참조 불안정 → 무한 렌더 루프

Hook의 `useEffect` 의존성에 Mock 반환값이 포함되면, **매 렌더마다 새 객체가 생성**되어 무한 루프가 발생한다.

```ts
// ❌ BAD — 호출할 때마다 새 객체 생성 → 무한 렌더
vi.mock('../../hooks/useToast', () => ({
    useToast: () => ({ showToast: vi.fn() }),  // 매번 새 vi.fn()
}));

// ✅ GOOD — 외부에서 한 번만 생성 → 안정적 참조
const mockShowToast = vi.fn();
vi.mock('../../hooks/useToast', () => ({
    useToast: () => ({ showToast: mockShowToast }),
}));
```

> **증상**: 테스트가 5000ms 타임아웃으로 실패. `act()` 경고가 대량 출력.

#### 함정 2: 미mock 비동기 함수 → 타임아웃

Hook 내부의 `useEffect`가 호출하는 비동기 함수가 mock되지 않으면, Promise가 영원히 미결(pending) 상태로 남는다.

```ts
// ❌ BAD — getVehicleEndKmBefore가 mock에 없음 → Promise 미결 → 타임아웃
vi.mock('../../lib/firestore', () => ({
    getVehicles: vi.fn(),
    getLastVehicleEndKm: vi.fn(),
    // getVehicleEndKmBefore 누락!
}));

// ✅ GOOD — useEffect가 호출할 수 있는 모든 함수를 mock
vi.mock('../../lib/firestore', () => ({
    getVehicles: vi.fn(),
    getLastVehicleEndKm: vi.fn(),
    getVehicleEndKmBefore: vi.fn().mockResolvedValue(null),
}));
```

> **증상**: 특정 테스트만 타임아웃. 로직이 단순해 보이는데 왜 느린지 이해가 안 됨.

#### 함정 3: exhaustive-deps + Mock 충돌

`useAuth()`의 `user` 객체처럼 **넓은 객체**를 의존성 배열에 넣으면, 메타데이터 변경(`displayName` 등)만으로도 effect가 재실행된다.

```ts
// ❌ BAD — user 전체를 의존성에 → 불필요한 재실행
useEffect(() => {
    fetchData(user.orgId);
}, [user]);  // user.displayName 변경에도 트리거

// ✅ GOOD — 필요한 값만 추출
useEffect(() => {
    fetchData(user.orgId);
}, [user.orgId]);  // orgId가 바뀔 때만 트리거
```

> 부득이하게 넓은 객체를 써야 하면 `// eslint-disable-next-line react-hooks/exhaustive-deps` 주석을 추가하되, **stale closure 위험이 없는지 반드시 검증** 후 사용한다.

---

### 테스트 이름 작성 규칙

- 한글로 작성 (`it('성공 시 결과를 반환한다')`)
- "~한다" 형식으로 동작을 서술
- 에러 케이스: `'XXX 에러 시 토스트를 표시한다'`

## 2. Cloud Functions 테스트

### 순수 단위 테스트 (`*.test.ts`)

Firebase Admin을 mock하여 네트워크 없이 실행:

```ts
vi.mock('firebase-admin/firestore', () => ({
    getFirestore: () => mockDb,
}));
```

### Emulator 연동 테스트 (`*.emulator.test.ts`)

실제 Emulator에 데이터를 넣고 검증:

```ts
import { setup, teardown } from './emulator.setup';

beforeAll(async () => { await setup(); });
afterAll(async () => { await teardown(); });
```

> Emulator 테스트는 CI에서 실행 시간이 길므로, 핵심 비즈니스 로직에만 사용.

## 3. E2E 테스트 (Playwright)

### 파일 위치

`e2e/` 디렉터리에 `기능명.spec.ts`로 생성.

### 작성 원칙

1. **Happy Path 우선**: 핵심 사용자 흐름을 먼저 확보
2. **인증 우회**: Firebase Emulator의 test token 사용
3. **DOM 안정성**: `page.waitForSelector` 대신 `expect(locator).toBeVisible()` 사용
4. **불안정 테스트**: 네트워크 의존 테스트는 `test.fixme()`로 마킹

```ts
import { test, expect } from '@playwright/test';

test('랜딩 페이지가 정상 로드된다', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toBeVisible();
    await expect(page).toHaveTitle(/차량운행일지/);
});
```

## 4. 언제 테스트를 작성하는가

> [agents.md §5.3 판단 가이드](../agents.md) 참고

| 상황 | 테스트 여부 |
|------|-----------|
| 비즈니스 로직이 있는 Hook | ✅ 필수 |
| 유틸/헬퍼 함수 | ✅ 필수 |
| Cloud Function (onCall, trigger) | ✅ 필수 |
| 순수 UI 컴포넌트 (표시만) | ❌ 불필요 |
| 라우팅/레이아웃 변경 | ❌ 불필요 |

## 5. 실행 명령어

```bash
npm run test         # 프론트엔드 단위 테스트
npm run test:e2e     # E2E 테스트
```

> 전체 테스트 스위트 실행은 `/test` 워크플로우를 사용한다.
