/**
 * mask — 로그·화면 노출용 개인정보 마스킹 유틸리티
 *
 * Cloud Logging에 이메일·전화번호·이름이 평문으로 남지 않도록
 * 모든 로그 출력에서 이 유틸을 거친다 (2026-07-11 평가 지적 대응).
 * verifyHelpers의 기관 검증 알림에서도 동일 유틸을 사용한다.
 */

/**
 * 이름 마스킹 (가운데 글자 → *)
 * 예: "김종원" → "김*원", "홍길동" → "홍*동", "김수" → "김*"
 */
export function maskName(name: string | null | undefined): string {
    if (!name || name.length === 0) return "알 수 없음";
    if (name.length === 1) return name;
    if (name.length === 2) return name[0] + "*";
    const first = name[0];
    const last = name[name.length - 1];
    const middle = "*".repeat(name.length - 2);
    return first + middle + last;
}

/**
 * 이메일 마스킹 (앞 2글자만 표시, 나머지 ***)
 * 예: "example@email.com" → "ex***@email.com"
 */
export function maskEmail(email: string | null | undefined): string {
    if (!email || !email.includes("@")) return "알 수 없음";
    const [local, domain] = email.split("@");
    if (local.length <= 2) return local + "***@" + domain;
    return local.substring(0, 2) + "***@" + domain;
}

/**
 * 전화번호 마스킹 (앞 3자리·뒤 4자리만 표시)
 * 예: "010-1234-5678" → "010****5678", "01012345678" → "010****5678"
 */
export function maskPhone(phone: string | null | undefined): string {
    if (!phone) return "알 수 없음";
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 8) return "***";
    return digits.slice(0, 3) + "****" + digits.slice(-4);
}
