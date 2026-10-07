import { describe, it, expect, beforeEach, vi } from 'vitest';

const HINT_KEY = 'vdl:returning-visitor';
const COOKIE = 'vdl_seen';
const LOGOUT_KEY = 'vdl:intentional-logout';
const LOSS_KEY = 'vdl:session-loss';

/**
 * 모듈을 새로 들여온다.
 *
 * 두 가지 이유로 필요하다.
 *   ① 의도적 로그아웃 표시는 모듈 변수 + localStorage 두 겹이라, resetModules 없이는 앞
 *      테스트의 표시가 10초 창 안에서 그대로 살아 있다.
 *   ② 부팅 스냅숏이 **모듈 평가 시점에** 찍힌다. 그래서 저장소·쿠키 준비는 반드시 load()
 *      **앞**에서 해야 한다 — 이 순서가 곧 프로덕션의 순서다(부팅 → Firebase 초기화).
 */
async function load() {
    vi.resetModules();
    return import('@/lib/sessionBoot');
}

/** 증거 수집이 비동기라 기록은 마이크로태스크 뒤에 남는다. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const setCookieMark = () => { document.cookie = `${COOKIE}=1; Path=/`; };
const hasCookieMark = () => document.cookie.split('; ').includes(`${COOKIE}=1`);

beforeEach(() => {
    localStorage.clear();
    document.cookie = `${COOKIE}=; Max-Age=0; Path=/`;
});

describe('sessionBoot — 재방문 표식', () => {
    it('저장소와 쿠키 두 곳에 함께 남기고 함께 지운다', async () => {
        const { readReturningHint, writeReturningHint } = await load();

        writeReturningHint(true);
        expect(readReturningHint()).toBe(true);
        expect(hasCookieMark()).toBe(true);

        writeReturningHint(false);
        expect(localStorage.getItem(HINT_KEY)).toBeNull();
        expect(hasCookieMark()).toBe(false);
    });

    it('clearSessionMarkers도 두 곳을 함께 지운다 (앱이 이미 보고한 종료의 뒤처리)', async () => {
        const { writeReturningHint, clearSessionMarkers } = await load();

        writeReturningHint(true);
        clearSessionMarkers();

        expect(localStorage.getItem(HINT_KEY)).toBeNull();
        expect(hasCookieMark()).toBe(false);
    });
});

describe('sessionBoot — 의도적 로그아웃 표식', () => {
    it('다른 탭이 볼 수 있도록 스토리지에도 남긴다 (한 탭의 로그아웃이 다른 탭을 끌고 간다)', async () => {
        const { markIntentionalLogout, wasIntentionalLogout } = await load();

        markIntentionalLogout();

        expect(localStorage.getItem(LOGOUT_KEY)).not.toBeNull();
        expect(wasIntentionalLogout()).toBe(true);
    });

    it('창을 벗어난 옛 표시는 무시한다 (나중의 진짜 세션 소멸을 덮지 않게)', async () => {
        localStorage.setItem(LOGOUT_KEY, String(Date.now() - 60_000));
        const { wasIntentionalLogout } = await load();

        expect(wasIntentionalLogout()).toBe(false);
    });
});

describe('sessionBoot — 세션 소실 증거', () => {
    it('로그인한 적 없는 브라우저에서는 아무것도 적지 않는다 (첫 방문은 소실이 아니다)', async () => {
        const { noteUnauthenticatedBoot } = await load();

        noteUnauthenticatedBoot();
        await flush();

        expect(localStorage.getItem(LOSS_KEY)).toBeNull();
    });

    it('사용자가 스스로 로그아웃한 직후에는 적지 않는다 (정상 경로를 오탐하지 않는다)', async () => {
        localStorage.setItem(HINT_KEY, '1');
        setCookieMark();
        localStorage.setItem(LOGOUT_KEY, String(Date.now()));
        const { noteUnauthenticatedBoot } = await load();

        noteUnauthenticatedBoot();
        await flush();

        expect(localStorage.getItem(LOSS_KEY)).toBeNull();
    });

    it('로그인한 적 있는데 세션이 없으면 증거를 적는다', async () => {
        localStorage.setItem(HINT_KEY, '1');
        setCookieMark();
        const { noteUnauthenticatedBoot, takePendingSessionLoss } = await load();

        noteUnauthenticatedBoot();
        await flush();

        const evidence = takePendingSessionLoss();
        expect(evidence).not.toBeNull();
        expect(evidence!.returningHint).toBe(true);
        expect(evidence!.cookieMark).toBe(true);
    });

    /**
     * 이 계측을 만든 이유 자체다 — 휴대폰의 저장소 축출은 localStorage와 IndexedDB를 함께
     * 비우므로 재방문 힌트도 사라진다. 쿠키가 없으면 이 부팅은 "처음 온 사람"과 구분되지
     * 않아, 정작 보고 싶은 사건만 관측하지 못한다.
     */
    it('저장소가 통째로 비워져도 쿠키가 남아 있으면 보고한다', async () => {
        setCookieMark(); // localStorage는 비어 있다 — 힌트도 앱 키도 없다
        const { noteUnauthenticatedBoot, takePendingSessionLoss } = await load();

        noteUnauthenticatedBoot();
        await flush();

        const evidence = takePendingSessionLoss();
        expect(evidence).not.toBeNull();
        expect(evidence!.returningHint).toBe(false);
        expect(evidence!.cookieMark).toBe(true);
        // 힌트를 세지 않으므로 0이 "localStorage가 비워졌다"를 뜻할 수 있다
        expect(evidence!.appKeys).toBe(0);
    });

    it('앱 키 개수에 재방문 힌트는 세지 않는다 (0이 의미를 갖게)', async () => {
        localStorage.setItem(HINT_KEY, '1');
        localStorage.setItem('tmap_geo_cache_v1', '[]');
        localStorage.setItem('preferred-nav-app', 'tmap');
        const { noteUnauthenticatedBoot, takePendingSessionLoss } = await load();

        noteUnauthenticatedBoot();
        await flush();

        expect(takePendingSessionLoss()!.appKeys).toBe(2);
    });

    /**
     * 스냅숏을 모듈 평가 시점에 찍는 이유. 프로덕션에서 Firebase Auth는 초기화 중에
     * 1순위가 아닌 저장소의 세션 키를 지운다 — 그 뒤에 읽으면 이 값이 언제나 false로 굳는다.
     */
    it('예전 빌드가 localStorage에 남긴 세션 사본을 부팅 시점 기준으로 본다', async () => {
        localStorage.setItem(HINT_KEY, '1');
        localStorage.setItem('firebase:authUser:key:[DEFAULT]', '{}');
        const { noteUnauthenticatedBoot, takePendingSessionLoss } = await load();

        // Firebase가 초기화 중에 지우는 것을 흉내낸다 — 스냅숏은 이미 찍혔어야 한다
        localStorage.removeItem('firebase:authUser:key:[DEFAULT]');

        noteUnauthenticatedBoot();
        await flush();

        expect(takePendingSessionLoss()!.legacyLocalCopy).toBe(true);
    });

    /**
     * sentryScrub은 허용 목록에 없는 **문자열을** 통째로 지운다(자유 입력 유출 차단).
     * 증거에 문자열을 실으면 Sentry에 `[redacted string(n)]`으로만 도착한다.
     */
    it('증거에 문자열을 싣지 않는다 (Sentry 스크러빙에 지워지지 않게)', async () => {
        localStorage.setItem(HINT_KEY, '1');
        const { noteUnauthenticatedBoot, takePendingSessionLoss } = await load();

        noteUnauthenticatedBoot();
        await flush();

        const evidence = takePendingSessionLoss()!;
        const stringFields = Object.entries(evidence)
            .filter(([, value]) => typeof value === 'string')
            .map(([key]) => key);
        expect(stringFields).toEqual([]);
    });

    it('보고한 뒤 표식을 내린다 — 같은 건이 부팅마다 반복 보고되지 않게', async () => {
        localStorage.setItem(HINT_KEY, '1');
        setCookieMark();
        const { noteUnauthenticatedBoot } = await load();

        noteUnauthenticatedBoot();
        await flush();

        expect(localStorage.getItem(HINT_KEY)).toBeNull();
        expect(hasCookieMark()).toBe(false);
    });

    it('꺼낸 증거는 지운다 — 같은 건이 다음 로그인마다 반복 보고되지 않게', async () => {
        localStorage.setItem(HINT_KEY, '1');
        const { noteUnauthenticatedBoot, takePendingSessionLoss } = await load();

        noteUnauthenticatedBoot();
        await flush();

        expect(takePendingSessionLoss()).not.toBeNull();
        expect(takePendingSessionLoss()).toBeNull();
        expect(localStorage.getItem(LOSS_KEY)).toBeNull();
    });

    it('깨진 기록은 null로 돌려준다 (부팅을 깨뜨리지 않는다)', async () => {
        const { takePendingSessionLoss } = await load();

        localStorage.setItem(LOSS_KEY, '{not json');

        expect(takePendingSessionLoss()).toBeNull();
    });

    it('저장소가 막혀 있어도 부팅을 막지 않는다', async () => {
        localStorage.setItem(HINT_KEY, '1');
        const { noteUnauthenticatedBoot } = await load();

        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('QuotaExceededError');
        });

        expect(() => noteUnauthenticatedBoot()).not.toThrow();
        await flush();

        setItem.mockRestore();
    });
});
