/**
 * sentryScrub.test — Cloud Functions 진단 문맥의 개인정보 차단 검증
 *
 * 설계 원칙(문자열 기본 차단 + 전용 허용 키 + 민감 패턴 마스킹)과 실제 호출부에서
 * 찾은 누출 경로(T맵 응답 본문·IP·오류 메시지 속 이메일)를 회귀 테스트로 고정한다.
 */
import { maskSensitiveText, scrubContext, scrubSentryEvent } from "../core/sentryScrub";

describe("maskSensitiveText — 문자열 속 민감 패턴만 가린다", () => {
    it("이메일은 앞 2글자와 도메인만 남긴다", () => {
        expect(maskSensitiveText("user hong.gildong@example.com not found"))
            .toBe("user ho***@example.com not found");
    });

    it("전화번호는 앞자리·뒤 4자리만 남긴다", () => {
        expect(maskSensitiveText("연락처 010-1234-5678 로 발송 실패")).toBe("연락처 010-****-5678 로 발송 실패");
    });

    it("사업자등록번호 뒷자리를 가린다", () => {
        expect(maskSensitiveText("사업자 123-45-67890 검증 실패")).toBe("사업자 123-45-***** 검증 실패");
    });

    it("구분자 없는 숫자(주행거리·문서 ID)는 건드리지 않는다", () => {
        expect(maskSensitiveText("startKm 01012345678 logId abc123")).toBe("startKm 01012345678 logId abc123");
    });
});

describe("scrubContext — 허용 키만 남기고 나머지 문자열은 모양만 남긴다", () => {
    it("보고 지점·ID·숫자·날짜는 남긴다", () => {
        const out = scrubContext({
            context: "onDriveLogUpdated", orgId: "org1", vehId: "veh1", logId: "log1",
            count: 3, ok: true, currentTime: "2026-11-24T09:00", year: 2026,
        });
        expect(out).toEqual({
            context: "onDriveLogUpdated", orgId: "org1", vehId: "veh1", logId: "log1",
            count: 3, ok: true, currentTime: "2026-11-24T09:00", year: 2026,
        });
    });

    it("tmapProxy의 응답 본문(body)은 지운다 — 목적지 주소가 실릴 수 있다", () => {
        const out = scrubContext({ status: 200, body: "{\"poi\":\"○○구 ○○로 12 어르신 댁\"}" });
        expect(out.status).toBe(200);
        expect(out.body).toMatch(/^\[redacted string\(\d+\)\]$/);
    });

    it("rateLimit의 IP는 지운다", () => {
        expect(scrubContext({ ip: "203_0_113_7", uid: "u1" })).toEqual({
            ip: "[redacted string(11)]", uid: "u1",
        });
    });

    it("허용 키라도 오류 메시지 속 이메일은 가린다", () => {
        const out = scrubContext({ error: "calendar hong@gmail.com: 403 forbidden" });
        expect(out.error).toBe("calendar ho***@gmail.com: 403 forbidden");
    });

    it("문서 덤프 같은 중첩 객체는 키 단위로 훑는다", () => {
        const out = scrubContext({
            data: { destination: "○○병원", passengers: ["홍길동"], startKm: 1200, vehicleId: "v1" },
        });
        expect(out.data).toEqual({
            destination: "[redacted string(4)]",
            passengers: ["[redacted string(3)]"],
            startKm: 1200,
            vehicleId: "v1",
        });
    });

    it("Error 값은 메시지를 남기되 민감 패턴을 가린다", () => {
        const out = scrubContext({ error: new Error("no user 010-9876-5432") });
        expect(out.error).toBe("Error: no user 010-****-5432");
    });

    it("순환 참조·깊은 중첩에도 던지지 않는다", () => {
        const a: Record<string, unknown> = { orgId: "o1" };
        a.self = a;
        const deep = { x: { y: { z: { w: { v: 1 } } } } };
        expect(() => scrubContext({ a, deep })).not.toThrow();
        const out = scrubContext({ a }) as { a: Record<string, unknown> };
        expect(out.a.self).toBe("[circular]");
    });

    it("getter가 던져도 형제 키는 살린다", () => {
        const ctx: Record<string, unknown> = { orgId: "o1" };
        Object.defineProperty(ctx, "boom", { enumerable: true, get() { throw new Error("x"); } });
        expect(scrubContext(ctx)).toEqual({ orgId: "o1", boom: "[unreadable]" });
    });

    it("syncHolidays의 전용 이름(holidayApiBodyPreview)은 남긴다", () => {
        expect(scrubContext({ holidayApiBodyPreview: "<html>error</html>" }))
            .toEqual({ holidayApiBodyPreview: "<html>error</html>" });
    });
});

describe("scrubSentryEvent — beforeSend에서 이벤트 전체를 거른다", () => {
    it("예외 메시지·message·extra를 모두 거른다", () => {
        const event = {
            message: "warn for a@b.co",
            exception: { values: [{ value: "failed for hong@example.com" }] },
            extra: { email: "hong@example.com", orgId: "o1" },
        };
        const out = scrubSentryEvent(event);
        expect(out.message).toBe("warn for a***@b.co");
        expect(out.exception.values[0].value).toBe("failed for ho***@example.com");
        expect(out.extra).toEqual({ email: "[redacted string(16)]", orgId: "o1" });
    });
});
