/**
 * clientIp.test.ts — 레이트리밋 키로 쓸 IP가 **호출자에 의해 조작되지 않는지** 검증한다.
 *
 * 이 테스트가 지키는 것은 2026-08-14 감사 발견 2다: 예전 구현은 X-Forwarded-For의 맨 앞
 * 값(= 클라이언트가 적어 넣은 문자열)을 그대로 썼고, 그래서 헤더 한 줄로 모든 IP 상한을
 * 무한히 우회할 수 있었다. 아래 "스푸핑" 케이스가 다시 통과하면 그 구멍이 되살아난 것이다.
 */
import { resolveClientIp } from "../utils/clientIp";

/** GCP는 XFF 끝에 `<실제 클라이언트>, <로드밸런서>`를 덧붙인다. */
const REAL_CLIENT = "203.0.113.7";
const LOAD_BALANCER = "35.191.0.1";

function req(xff?: string | string[], ip?: string) {
    return { headers: xff === undefined ? {} : { "x-forwarded-for": xff }, ip };
}

describe("resolveClientIp — 조작 불가능한 클라이언트 IP", () => {
    it("정상 요청: 오른쪽에서 두 번째(실제 클라이언트)를 고른다", () => {
        expect(resolveClientIp(req(`${REAL_CLIENT}, ${LOAD_BALANCER}`))).toBe(REAL_CLIENT);
    });

    it("스푸핑: 앞에 가짜 IP를 넣어도 결과가 바뀌지 않는다", () => {
        const spoofed = req(`1.1.1.1, ${REAL_CLIENT}, ${LOAD_BALANCER}`);
        expect(resolveClientIp(spoofed)).toBe(REAL_CLIENT);
    });

    it("스푸핑: 가짜를 여러 개 넣어도, 매번 다른 값을 넣어도 결과가 고정된다", () => {
        const first = resolveClientIp(req(`9.9.9.9, 8.8.8.8, 7.7.7.7, ${REAL_CLIENT}, ${LOAD_BALANCER}`));
        const second = resolveClientIp(req(`4.4.4.4, 5.5.5.5, ${REAL_CLIENT}, ${LOAD_BALANCER}`));
        expect(first).toBe(REAL_CLIENT);
        expect(second).toBe(REAL_CLIENT);
        // 레이트리밋 버킷이 갈리지 않는다는 것이 이 테스트의 핵심이다.
        expect(first).toBe(second);
    });

    it("헤더가 여러 번 실려 배열로 와도 하나로 이어 붙여 판정한다", () => {
        expect(resolveClientIp(req(["1.1.1.1", `${REAL_CLIENT}, ${LOAD_BALANCER}`]))).toBe(REAL_CLIENT);
    });

    it("공백·빈 항목이 섞여도 자리 계산이 밀리지 않는다", () => {
        expect(resolveClientIp(req(`  1.1.1.1 , , ${REAL_CLIENT} ,  ${LOAD_BALANCER} `))).toBe(REAL_CLIENT);
    });

    it("XFF가 한 개뿐이면(에뮬레이터·로컬) 그 값을 쓴다", () => {
        expect(resolveClientIp(req(REAL_CLIENT))).toBe(REAL_CLIENT);
    });

    it("XFF가 없으면 req.ip로 물러선다", () => {
        expect(resolveClientIp(req(undefined, "127.0.0.1"))).toBe("127.0.0.1");
    });

    it("아무 단서도 없으면 'unknown'", () => {
        expect(resolveClientIp(req(undefined, undefined))).toBe("unknown");
        expect(resolveClientIp(undefined)).toBe("unknown");
    });

    it("IPv6도 그대로 돌려준다", () => {
        expect(resolveClientIp(req(`2001:db8::1, ${LOAD_BALANCER}`))).toBe("2001:db8::1");
    });
});
