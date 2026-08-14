/**
 * promptImageUrl.test.ts — 서버가 대신 가져올 수 있는 주소를 자기 Storage로 한정한다.
 *
 * 2026-08-14 감사 발견 3: `imageUrls`는 사용자가 만든 Firestore 문서의 필드인데
 * `fetchPromptImages`가 검증 없이 그대로 fetch해, 내부망·제3자 서버로 향하는 SSRF
 * 통로가 열려 있었다. 아래 "거절" 케이스가 통과로 바뀌면 그 통로가 되살아난 것이다.
 */
import { isAllowedPromptImageUrl } from "../utils/helpers";

describe("isAllowedPromptImageUrl — 프롬프트 첨부 이미지 호스트 화이트리스트", () => {
    describe("허용 — 앱이 실제로 만드는 주소", () => {
        it("getDownloadURL이 돌려주는 firebasestorage 주소", () => {
            expect(isAllowedPromptImageUrl(
                "https://firebasestorage.googleapis.com/v0/b/vehicle-drive-log.appspot.com/o/feedbacks%2Fuid%2F1.jpg?alt=media&token=abc",
            )).toBe(true);
        });

        it("GCS 직접 주소", () => {
            expect(isAllowedPromptImageUrl("https://storage.googleapis.com/bucket/feedbacks/uid/1.jpg")).toBe(true);
        });

        it("신규 기본 버킷 도메인(.firebasestorage.app)", () => {
            expect(isAllowedPromptImageUrl("https://vehicle-drive-log.firebasestorage.app/o/x.jpg")).toBe(true);
        });
    });

    describe("거절 — SSRF 통로", () => {
        it("메타데이터 서버", () => {
            expect(isAllowedPromptImageUrl(
                "http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token",
            )).toBe(false);
        });

        it("사설망 주소", () => {
            expect(isAllowedPromptImageUrl("https://10.0.0.5/internal")).toBe(false);
            expect(isAllowedPromptImageUrl("https://localhost:8080/admin")).toBe(false);
        });

        it("제3자 서버 (외부로 요청을 대신 보내게 하는 경로)", () => {
            expect(isAllowedPromptImageUrl("https://attacker.example.com/beacon.jpg")).toBe(false);
        });

        it("https가 아닌 스킴", () => {
            expect(isAllowedPromptImageUrl("http://firebasestorage.googleapis.com/x.jpg")).toBe(false);
            expect(isAllowedPromptImageUrl("file:///etc/passwd")).toBe(false);
            expect(isAllowedPromptImageUrl("gs://bucket/x.jpg")).toBe(false);
        });

        it("허용 호스트를 흉내 낸 주소 — 접미사·서브도메인 트릭", () => {
            // 호스트 전체 일치를 요구하므로 아래는 전부 다른 호스트다.
            expect(isAllowedPromptImageUrl("https://firebasestorage.googleapis.com.evil.test/x.jpg")).toBe(false);
            expect(isAllowedPromptImageUrl("https://evil-firebasestorage.app/x.jpg")).toBe(false);
            // 자격증명 자리에 허용 호스트를 넣어도 실제 호스트는 attacker다.
            expect(isAllowedPromptImageUrl("https://firebasestorage.googleapis.com@attacker.test/x.jpg")).toBe(false);
        });

        it("URL이 아닌 값", () => {
            expect(isAllowedPromptImageUrl("")).toBe(false);
            expect(isAllowedPromptImageUrl("그냥 문자열")).toBe(false);
            expect(isAllowedPromptImageUrl("/relative/path.jpg")).toBe(false);
        });
    });
});
