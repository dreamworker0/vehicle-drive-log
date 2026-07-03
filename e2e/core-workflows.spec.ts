import { test } from '@playwright/test';

/**
 * 핵심 워크플로우(예약 생성·운행일지 작성·데이터 내보내기) E2E.
 *
 * 이 플로우들은 모두 "로그인된 직원/관리자" 상태를 전제로 하지만, 현재 E2E 환경은
 *   1) 앱이 실제 Firebase에 연결됨(에뮬레이터 연결 분기 없음)
 *   2) 로그인이 Google OAuth 전용이라 Playwright로 로그인 세션을 만들 수 없음
 * 이라는 두 가지 제약 때문에 인증 후 화면을 띄울 수 없다.
 *
 * 과거에는 `await expect(page).toHaveTitle(...)`만 호출하고 본문을 주석 처리해
 * "통과처럼 보이지만 아무것도 검증하지 않는" 테스트였다. 거짓 신호를 주므로 제거하고,
 * 아래와 같이 핵심 로직은 단위/통합 테스트로 위임한다.
 *
 *   - 예약 생성(동시성·시간겹침·취소/완료 예약 처리)
 *       → functions/src/__tests__/createReservationSafe.test.ts
 *   - 운행일지 제출(신규/수정/예약연계/오프라인/하이패스)
 *       → src/__tests__/hooks/submitDriveLog.test.ts, useDriveLogForm.test.ts
 *   - 엑셀/PDF 내보내기
 *       → src/__tests__/lib/excelExport.test.ts
 *
 * [2026-07-03 현행화] 에뮬레이터 기반 인증 E2E 인프라는 이제 존재하며(playwright.emulator.config.ts,
 * authed-*.spec.ts) CI 게이트로도 실행된다. 이 플로우들을 E2E로 승격하려면 authed-* 스펙으로
 * 이관해 구현하면 된다 — 현재는 위 단위/통합 테스트가 로직을 커버하므로 보류 상태 유지.
 */
test.describe('핵심 워크플로우 E2E (authed-* 에뮬레이터 스펙으로 이관 가능 — 단위 테스트가 커버 중)', () => {
    // 승인/반려 여정은 authed-reservationApproval.spec.ts로 이관·구현됨(에뮬레이터 E2E).
    // 예약 "생성"은 createReservationSafe 콜러블 경유라 functions 에뮬레이터가 없는 E2E 환경에서
    // UI로 재현 불가 — createReservationSafe.test.ts가 서버 생성 로직을 커버한다.

    // '운행기록일지 작성 및 첨부파일 검증'은 authed-driveLogCreate.spec.ts로 이관·구현됨(에뮬레이터 E2E).

    // '관리자 데이터 내보내기'는 authed-driveLogExport.spec.ts로 이관·구현됨(에뮬레이터 E2E, 엑셀 다운로드).
    // PDF는 window.open+print(인쇄 대화상자)라 헤드리스 자동화 불가 — excelExport.test.ts가 직렬화 로직 커버.
});
