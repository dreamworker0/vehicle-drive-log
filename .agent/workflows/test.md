---
description: 단위 테스트(Vitest)와 E2E 테스트(Playwright)를 한번에 실행
---

// turbo-all

1. Run unit tests (Vitest):
```
npm run test
```
Working directory: `.`

2. Run E2E tests (Playwright):
```
npm run test:e2e
```
Working directory: `.`

> 💡 **Vitest 실행 시 자주 발생하는 에러**
> - **auth/invalid-api-key**: `.env.test`나 로컬 환경에 Firebase 설정 키가 누락되었는지 확인하거나, `src/lib/firebase.ts`를 Mock 처리하도록 `vi.mock`을 최상단에 배치하세요.
> - **not wrapped in act(...)**: 상태 변경(state update)을 유발하는 테스트 동작은 반드시 `act(async () => { ... })` 블록 내에서 실행되어야 합니다.
