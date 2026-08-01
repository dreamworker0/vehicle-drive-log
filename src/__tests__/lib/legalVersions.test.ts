/**
 * 약관·처리방침 버전 상수 형식 검증
 *
 * 서버(submitOrgApplication·joinOrganization·acceptCurrentTerms)는 동의 버전을
 * `YYYY-MM-DD`로만 받는다. 상수가 이 형식을 벗어나면 기관 신청·직원 가입·재동의가
 * 전부 "약관 버전 정보가 올바르지 않습니다"로 거부되고, 사용자는 원인을 알 수 없어
 * 재시도를 반복하다 rate limit에 갇힌다. 배포 전에 CI에서 잡는다.
 */
import { describe, it, expect } from 'vitest';
import { TERMS_VERSION, PRIVACY_VERSION, formatLegalVersion } from '../../lib/constants';

/** 서버 측 VERSION_PATTERN과 동일해야 한다 */
const SERVER_VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

describe('약관·처리방침 버전 상수', () => {
    it.each([
        ['TERMS_VERSION', TERMS_VERSION],
        ['PRIVACY_VERSION', PRIVACY_VERSION],
    ])('%s는 서버가 허용하는 YYYY-MM-DD 형식이다', (_name, version) => {
        expect(version).toMatch(SERVER_VERSION_PATTERN);
    });

    it.each([
        ['TERMS_VERSION', TERMS_VERSION],
        ['PRIVACY_VERSION', PRIVACY_VERSION],
    ])('%s는 실재하는 날짜다', (_name, version) => {
        const [year, month, day] = version.split('-').map(Number);
        const date = new Date(Date.UTC(year, month - 1, day));
        expect(date.getUTCFullYear()).toBe(year);
        expect(date.getUTCMonth() + 1).toBe(month);
        expect(date.getUTCDate()).toBe(day);
    });

    it('약관과 처리방침의 시행일은 같다 — 한쪽만 올리면 고지 공백이 생긴다', () => {
        // 약관 제9조(개인정보 처리의 위탁)와 처리방침 제7·8조(위탁·국외 이전)는 짝이다.
        // 한쪽만 올리면 "약관은 위탁을 규정하는데 처리방침 구버전에는 수탁자 고지가 없는"
        // 구간이 시행일 차이만큼 생긴다.
        expect(PRIVACY_VERSION).toBe(TERMS_VERSION);
    });

    it('formatLegalVersion은 문서 표기용 한국어 날짜를 만든다', () => {
        expect(formatLegalVersion('2026-08-05')).toBe('2026년 8월 5일');
        // 앞자리 0을 남기면 "08월 05일"이 되어 문서 표기와 어긋난다
        expect(formatLegalVersion('2026-01-01')).toBe('2026년 1월 1일');
        expect(formatLegalVersion('2026-12-31')).toBe('2026년 12월 31일');
    });
});
