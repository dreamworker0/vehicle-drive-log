import { describe, it, expect } from 'vitest';
import { resolveAuthDomain, HOSTING_AUTH_DOMAINS } from '../../lib/authDomain';

const ENV_DOMAIN = 'vehicle-drive-log.web.app';

describe('resolveAuthDomain', () => {
    it.each(HOSTING_AUTH_DOMAINS)('Hosting 도메인(%s)으로 접속하면 그 도메인을 authDomain으로 쓴다', (host) => {
        expect(resolveAuthDomain(ENV_DOMAIN, host)).toBe(host);
    });

    it('커스텀 도메인에서는 환경변수 값과 달라도 커스텀 도메인을 쓴다', () => {
        expect(resolveAuthDomain(ENV_DOMAIN, 'drivelog.socialprism.co.kr')).toBe('drivelog.socialprism.co.kr');
    });

    it('localhost는 환경변수 값을 쓴다', () => {
        expect(resolveAuthDomain(ENV_DOMAIN, 'localhost')).toBe(ENV_DOMAIN);
    });

    it('PR 미리보기 채널 도메인은 환경변수 값을 쓴다', () => {
        expect(resolveAuthDomain(ENV_DOMAIN, 'vehicle-drive-log--pr-392-4d6y2rk5.web.app')).toBe(ENV_DOMAIN);
    });

    it('비슷하지만 다른 도메인은 허용하지 않는다', () => {
        expect(resolveAuthDomain(ENV_DOMAIN, 'drivelog.socialprism.co.kr.evil.com')).toBe(ENV_DOMAIN);
    });
});
