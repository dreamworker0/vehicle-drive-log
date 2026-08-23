/**
 * inviteCode — 기관 초대 코드 생성 (암호학적 난수)
 *
 * ## 왜 Math.random()이면 안 되는가 (2026-08-23 감사 부록 1)
 *
 * 초대 코드는 **기관 데이터 전체에 대한 사실상 단일 자격증명**이다. 합류하면 그 기관의
 * 운행일지·직원 연락처·예약이 곧바로 열리고, 관리자가 없는 기관이면 합류자가 admin이 된다
 * (joinOrganization의 `hasAdmin ? "employee" : "admin"`).
 *
 * 그런데 생성은 `Math.random().toString(36).substring(2, 8)`이었다. V8의 Math.random은
 * xorshift128+ PRNG로, 출력 몇 개면 내부 상태를 복원해 **그 전후에 생성된 값을 계산할 수
 * 있다.** 대입 공격은 상한이 막지만(uid당 시간당 5회 + App Check), 예측은 상한이 막지 못한다.
 *
 * 같은 저장소가 OAuth nonce에는 이미 `randomUUID()`를 쓴다(services/slack/oauthState.ts).
 * 자격증명에 쓰는 난수는 전부 그 기준을 따른다.
 *
 * ## 알파벳
 *
 * 사람이 전화·문자로 받아 적는 코드라 혼동 문자(0/O, 1/I)를 뺀 32자를 쓴다. 32는 2의
 * 거듭제곱이라 바이트를 5비트로 잘라 쓰면 모듈로 편향이 없다 — 편향은 곧 엔트로피 손실이다.
 *
 * 기존 코드(0·1·O·I를 포함한 base36)는 그대로 유효하다. 검증부는 길이만 보므로
 * 알파벳 변경이 기존 기관의 합류를 깨지 않는다.
 */
import { randomBytes } from "node:crypto";

/** 혼동 문자(0/O/1/I) 제외 32자 — 2의 거듭제곱이라 5비트 슬라이스가 균일하다. */
export const INVITE_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** 초대 코드 길이 — joinOrganization의 검증(6자)과 화면 안내("6자리")에 맞춘다. */
export const INVITE_CODE_LENGTH = 6;

/** 암호학적 난수로 초대 코드를 만든다. */
export function generateInviteCode(): string {
    const bytes = randomBytes(INVITE_CODE_LENGTH);
    let code = "";
    for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
        code += INVITE_CODE_ALPHABET[bytes[i] & 31];
    }
    return code;
}
