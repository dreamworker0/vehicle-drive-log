# TypeScript 점진적 전환 계획

JavaScript → TypeScript 점진적 마이그레이션.
`allowJs: true`로 JS/TS 공존 환경을 만들고, 리프 모듈(lib)부터 루트(App)까지 단계적으로 전환한다.

## 전환 순서

| Phase | 대상 | 파일 수 | 설명 |
|-------|------|---------|------|
| **0** | 인프라 세팅 | 설정만 | tsconfig.json, vite-env.d.ts, ESLint 수정 |
| **1** | 타입 정의 + lib | ~30 | `src/types/`, `src/lib/`, `src/hooks/utils/` |
| **2** | Context + Hooks | ~25 | `src/contexts/`, `src/hooks/` |
| **3** | 컴포넌트 | ~62 | `src/components/` 전체 |
| **4** | 루트 + 테스트 + 설정 | ~25 | App.tsx, main.tsx, __tests__/, ESLint 강화 |
| **5** | Cloud Functions | ~20 | `functions/` (독립 진행) |

## Phase 0 — TS 인프라 세팅 ✅

기존 JS 코드를 건드리지 않고 TS 환경만 구성.

- [x] `typescript`, `@types/react`, `@types/react-dom` 설치
- [x] `tsconfig.json` 생성 (allowJs: true, noEmit: true, strict: true)
- [x] `src/vite-env.d.ts` 생성
- [x] `eslint.config.js` — ts/tsx 패턴 추가
- [x] 빌드 검증 통과
- [x] `tsc --noEmit` 통과

## Phase 1 — 타입 정의 + lib 유틸리티 ✅

다른 모든 모듈이 lib에 의존하므로, 타입을 먼저 확정하면 나머지 전환이 쉬워진다.

- [x] `src/types/` 디렉토리 — 도메인 타입 정의 (Vehicle, DriveLog, Reservation, User, Organization 등)
- [x] `src/lib/*.js` → `.ts` (16개)
- [x] `src/lib/firestore/*.js` → `.ts` (12개)
- [x] `src/hooks/utils/*.js` → `.ts` (3개)
- [ ] `typescript-eslint` 파서 적용

## Phase 2 — Context + Hooks ✅

Context와 커스텀 훅의 타입을 정의하여 컴포넌트 전환(Phase 3)의 기반을 마련한다.

- [x] `src/contexts/*.jsx` → `.tsx` (2개)
- [x] `src/hooks/*.js` → `.ts` / `.tsx` (21개)
- [x] Context 인터페이스 정의 및 `useAuth` 등 핵심 훅 타입 적용

## Phase 3 — 컴포넌트 전환

- [ ] `src/components/common/` (15개)
- [ ] `src/components/auth/` (7개)
- [ ] `src/components/employee/` (13개)
- [ ] `src/components/admin/` (17개)
- [ ] `src/components/superAdmin/` (10개)

## Phase 4 — 루트 + 테스트 + 설정

- [ ] `App.jsx` → `App.tsx`, `main.jsx` → `main.tsx`
- [ ] `index.html` — main.tsx 참조로 변경
- [ ] `__tests__/` 파일 전환
- [ ] `allowJs: false` 전환 (JS 파일이 없으면)

## Phase 5 — Cloud Functions (독립 진행)

- [ ] `functions/tsconfig.json` 별도 생성
- [ ] `functions/package.json`에 typescript 추가
- [ ] `functions/src/` 디렉토리 구조 재편

## 검증 기준

각 Phase 완료 시:
1. `npm run build` — 빌드 성공
2. `npx tsc --noEmit` — 타입 에러 0건
3. `npm test` — 기존 테스트 전부 통과
