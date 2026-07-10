/**
 * mask.test — 로그 PII 마스킹 유틸리티 단위 테스트
 *
 * maskName/maskEmail의 상세 케이스는 autoVerifyDocument.test.ts에서 검증하므로,
 * 여기서는 utils/mask 공개 계약(특히 신규 maskPhone)을 검증한다.
 */
import { maskPhone, maskEmail, maskName } from "../utils/mask";

describe("maskPhone() — 전화번호 마스킹", () => {
    it("하이픈 포함 번호 → 앞 3자리·뒤 4자리만 노출", () => {
        expect(maskPhone("010-1234-5678")).toBe("010****5678");
    });

    it("하이픈 없는 번호 → 동일하게 마스킹", () => {
        expect(maskPhone("01012345678")).toBe("010****5678");
    });

    it("공백·괄호가 섞여도 숫자만 추출해 마스킹", () => {
        expect(maskPhone("(010) 1234 5678")).toBe("010****5678");
    });

    it("null/undefined/빈 문자열 → '알 수 없음'", () => {
        expect(maskPhone(null)).toBe("알 수 없음");
        expect(maskPhone(undefined)).toBe("알 수 없음");
        expect(maskPhone("")).toBe("알 수 없음");
    });

    it("자릿수가 너무 짧으면 전체 마스킹('***')", () => {
        expect(maskPhone("1234567")).toBe("***");
    });

    it("원문 번호가 결과에 그대로 남지 않는다", () => {
        const phone = "010-9876-5432";
        const masked = maskPhone(phone);
        expect(masked).not.toContain("9876");
        expect(masked).not.toContain(phone.replace(/-/g, ""));
    });
});

describe("maskEmail()/maskName() — utils/mask 재수출 계약", () => {
    it("이메일 로컬파트는 앞 2글자만 노출된다", () => {
        expect(maskEmail("example@email.com")).toBe("ex***@email.com");
    });

    it("이름 가운데가 마스킹된다", () => {
        expect(maskName("홍길동")).toBe("홍*동");
    });
});
