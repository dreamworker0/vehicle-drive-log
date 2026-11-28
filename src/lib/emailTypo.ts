/**
 * 이메일 도메인 오타 추정 — 기관 신청서의 신청자 이메일용.
 *
 * 신청 이메일은 승인 메일(초대 코드)을 받는 곳이다. 도메인을 잘못 적으면 메일 발송 서비스는
 * "보냄"으로 응답해도 실제로는 아무에게도 닿지 않고, 신청자는 초대 코드를 못 받는다.
 * (2026-11-28 `gmail.com`을 `gmail.net`으로 적은 기관이 승인 메일을 못 받고 재신청했다가
 * 중복 고유번호로 거절된 일이 계기)
 *
 * 국내 기관 담당자가 주로 쓰는 메일 서비스의 **흔한 오타만** 명시적으로 고친다.
 * 편집 거리로 추정하면 기관 자체 도메인(예: `navy.mil`·`gmall.kr`)을 오타로 오인할 수 있어서다.
 */
const DOMAIN_TYPOS: Record<string, string> = {
    // gmail.com
    'gmail.net': 'gmail.com',
    'gmail.co': 'gmail.com',
    'gmail.con': 'gmail.com',
    'gmail.cm': 'gmail.com',
    'gmail.om': 'gmail.com',
    'gmail.co.kr': 'gmail.com',
    'gmail.kr': 'gmail.com',
    'gmial.com': 'gmail.com',
    'gmai.com': 'gmail.com',
    'gamil.com': 'gmail.com',
    'gmil.com': 'gmail.com',
    'gmaill.com': 'gmail.com',
    'gnail.com': 'gmail.com',
    'gmali.com': 'gmail.com',
    // naver.com
    'naver.net': 'naver.com',
    'naver.co': 'naver.com',
    'naver.con': 'naver.com',
    'naver.cm': 'naver.com',
    'naver.co.kr': 'naver.com',
    'naver.kr': 'naver.com',
    'navr.com': 'naver.com',
    'nave.com': 'naver.com',
    'naer.com': 'naver.com',
    'nvaer.com': 'naver.com',
    'navar.com': 'naver.com',
    'neaver.com': 'naver.com',
    // hanmail.net · daum.net
    'hanmail.com': 'hanmail.net',
    'hanmail.co.kr': 'hanmail.net',
    'hanmali.net': 'hanmail.net',
    'hanmai.net': 'hanmail.net',
    'hamail.net': 'hanmail.net',
    'daum.com': 'daum.net',
    'daum.co.kr': 'daum.net',
    // nate.com
    'nate.net': 'nate.com',
    'nate.co.kr': 'nate.com',
    // kakao.com
    'kakao.net': 'kakao.com',
    'kakao.co.kr': 'kakao.com',
};

/**
 * 흔한 도메인 오타면 고친 이메일 전체를 돌려주고, 아니면 null.
 * 형식이 이메일이 아니거나(아직 입력 중) 정상 도메인이면 null이다.
 */
export function suggestEmailFix(email: string): string | null {
    const trimmed = email.trim();
    const at = trimmed.lastIndexOf('@');
    if (at <= 0 || at === trimmed.length - 1) return null;
    const local = trimmed.slice(0, at);
    const domain = trimmed.slice(at + 1).toLowerCase();
    const fixed = DOMAIN_TYPOS[domain];
    return fixed ? `${local}@${fixed}` : null;
}
