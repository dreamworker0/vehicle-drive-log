import { test } from '@playwright/test';

/**
 * 예약 승인/반려 워크플로우 E2E.
 *
 * 과거 구현은 Playwright의 page.route()로 Firestore 요청 URL을 가로채 응답을
 * 모킹하려 했으나 이는 동작하지 않는다 — Firestore Web SDK는 일반 REST가 아니라
 * gRPC/WebChannel 스트림을 사용하므로 URL 패턴 라우팅으로 가로채지지 않는다. 게다가
 * 모든 단언이 "if (await button.isVisible()) { ... }"로 감싸여 있어, 로그인이 안 되어
 * 버튼이 렌더링되지 않으면 본문이 통째로 건너뛰어진다. 즉 "항상 통과하지만 아무것도
 * 검증하지 않는" 테스트였다. 거짓 신호를 제거하고 단위 테스트로 위임한다.
 *
 * 승인/반려 UI 동작(승인 토스트, 반려 모달·사유 입력·토스트)은 다음에서 검증된다:
 *   - src/__tests__/components/PendingReservationList.test.tsx
 *
 * 서버사이드 예약 생성·동시성·상태 전환은 다음에서 검증된다:
 *   - functions/src/__tests__/createReservationSafe.test.ts
 *
 * 인증 가능한 Firebase 에뮬레이터 기반 E2E 인프라가 갖춰지면 fixme를 해제하고 구현한다.
 */
test.describe('예약 승인/반려 워크플로우 (인증 필요 — 인프라 부재로 보류)', () => {
    test.fixme('승인 버튼 클릭 시 승인 토스트가 발생해야 한다', async () => {
        // PendingReservationList.test.tsx가 승인 동작을 커버한다.
    });

    test.fixme('반려 버튼 클릭 시 모달이 나타나고 반려 처리를 성공해야 한다', async () => {
        // PendingReservationList.test.tsx가 반려 모달·사유 입력·토스트를 커버한다.
    });
});
