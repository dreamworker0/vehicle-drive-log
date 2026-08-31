/**
 * 서비스 워커 업데이트 체크 — **거부를 반드시 받아 준다.**
 *
 * `registration.update()`는 SW 스크립트를 다시 받아 파싱하므로, 모바일 회선에서 전송이
 * 잘리면 그대로 거부된다. iOS Safari는 이때 `TypeError: SyntaxError: Unexpected end of script`를
 * 던진다(JAVASCRIPT-REACT-63 — iOS 18.7 / Mobile Safari 26.2, `/employee/today`).
 * 받아 주는 곳이 없으면 unhandledrejection으로 새어 **앱 버그처럼** Sentry에 올라온다.
 * 이미 필터로 막아 두고 있던 `Failed to update a ServiceWorker`·`Script … load failed`도
 * 같은 호출이 다른 브라우저에서 낸 변종이었다 — 원인은 하나였고 필터가 늘고 있었다.
 *
 * 실패 자체는 무시해도 되는 것이 맞다. 다음 주기(10분)와 다음 탭 복귀에 다시 확인하고,
 * 새 버전은 다음 내비게이션에서 반영된다(main.tsx의 SW 정책 주석 참고).
 * **새면 안 되는 것뿐이다.**
 *
 * 별도 모듈인 이유는 호출부(UpdatePrompt)가 `virtual:pwa-register`를 정적으로 가져와
 * 단위 테스트에서 해석되지 않기 때문이다 — 판정 로직만 떼어 테스트 가능한 자리에 둔다.
 */
export function checkForSwUpdate(registration: ServiceWorkerRegistration): void {
    registration.update().catch((err) => {
        console.debug('[PWA] SW 업데이트 체크 실패 — 다음 기회에 다시 확인합니다:', err);
    });
}
