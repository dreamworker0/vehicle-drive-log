---
name: write-test
description: React 단위 테스트(Vitest) 및 E2E 테스트(Playwright) 작성 컨벤션과 Mocking 가이드
---
# 차량운행일지 테스트 작성 가이드 (write-test)

새로운 기능을 추가할 때, 특히 **비즈니스 로직(Hook, Utils)** 혹은 **중요 UI(예약, 폼)** 수정 시 단위/E2E 테스트를 보강합니다.

## 1. 단위 테스트 (Vitest + React Testing Library)
- **위치**: 컴포넌트나 함수와 같은 ディ렉토리에 `__tests__` 폴더를 만들거나 `.test.ts`, `.test.tsx` 확장자를 사용합니다.
- **Mocking**: 
  Firebase Auth, Firestore 로직을 감싸는 커스텀 훅을 주로 Mocking 합니다. 
```typescript
import { render, screen } from "@testing-library/react";
import MyComponent from "./MyComponent";
import { vi } from "vitest";

// Mock 예시
vi.mock("@/lib/firebase", () => ({
  useAuth: vi.fn(() => ({ user: { uid: "test1" } }))
}));
```

## 2. E2E 테스트 (Playwright)
- **위치**: 프로젝트 루트나 `tests/e2e` 폴더 내에 위치합니다.
- **권장 사항**:
  - 사용자 인증은 로그인 화면부터 무작정 돌리기보다 Firebase Emulator 환경에서 Test token을 꽂아 시작 상태를 세팅하세요.
  - "차량 1개 예약 후 완료 화면으로 넘어가는가?" 와 같은 'Happy Path'를 우선 확보합니다.
