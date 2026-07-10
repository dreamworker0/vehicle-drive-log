/**
 * params — Cloud Functions 시크릿 파라미터 중앙 정의
 *
 * 실제 크리덴셜(외부 서비스 인증 정보)은 defineString/.env 평문이 아닌
 * Google Secret Manager(defineSecret)로 관리한다 (2026-07-11 평가 지적 대응).
 *
 * 배포 전제: 각 시크릿이 미리 등록되어 있어야 배포가 성공한다.
 *   firebase functions:secrets:set <NAME>
 * 그리고 functions/.env에서 동일 키를 제거해야 한다 (이름 충돌 시 배포 거부).
 *
 * 사용 규칙: 이 시크릿을 (간접적으로라도) 읽는 함수는 정의 옵션에
 * `secrets: [...]`를 선언해야 런타임 환경변수(process.env)로 주입된다.
 */
import { defineSecret } from "firebase-functions/params";

/** Gmail SMTP 앱 비밀번호 — core/mailer 사용 함수 전부 */
export const GMAIL_APP_PASSWORD = defineSecret("GMAIL_APP_PASSWORD");

/** EmailJS 프라이빗 키 — 기관 자동 검증 승인 메일 (verifyHelpers) */
export const EMAILJS_PRIVATE_KEY = defineSecret("EMAILJS_PRIVATE_KEY");

/** 알림톡 Cafe24 프록시 인증 토큰 — services/alimtalk 사용 함수 전부 */
export const ALIMTALK_PROXY_TOKEN = defineSecret("ALIMTALK_PROXY_TOKEN");

/** Google OAuth 클라이언트 시크릿 — 개인 캘린더 동기화 (personalCalendarSync) */
export const GOOGLE_OAUTH_CLIENT_SECRET = defineSecret("GOOGLE_OAUTH_CLIENT_SECRET");
