import { describe, it, expect, beforeEach, vi } from 'vitest';

const HINT_KEY = 'vdl:returning-visitor';
const LOGOUT_KEY = 'vdl:intentional-logout';
const LOSS_KEY = 'vdl:session-loss';

/**
 * 의도적 로그아웃 표시는 모듈 변수 + localStorage 두 겹이라 테스트마다 모듈을 새로 들여온다
 * (resetModules 없이는 앞 테스트의 표시가 10초 창 안에서 그대로 살아 있다).
 */
async function load() {
    vi.resetModules();
    return import('@/lib/sessionBoot');
}

/** 증거 수집이 비동기라 기록은 마이크로태스크 뒤에 남는다. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => localStorage.clear());

describe('sessionBoot — 재방문 힌트', () => {
    it('쓰면 읽히고, 내리면 키 자체가 사라진다', async () => {
        const { readReturningHint, writeReturningHint } = await load();

        writeReturningHint(true);
        expect(readReturningHint()).toBe(true);

        writeReturningHint(false);
        expect(localStorage.getItem(HINT_KEY)).toBeNull();
        expect(readReturningHint()).toBe(false);
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
        const { recordSessionLossIfSuspicious } = await load();

        recordSessionLossIfSuspicious();
        await flush();

        expect(localStorage.getItem(LOSS_KEY)).toBeNull();
    });

    it('사용자가 스스로 로그아웃한 직후에는 적지 않는다 (정상 경로를 오탐하지 않는다)', async () => {
        const { writeReturningHint, markIntentionalLogout, recordSessionLossIfSuspicious } = await load();

        writeReturningHint(true);
        markIntentionalLogout();
        recordSessionLossIfSuspicious();
        await flush();

        expect(localStorage.getItem(LOSS_KEY)).toBeNull();
    });

    it('로그인한 적 있는데 세션이 없으면 증거를 적는다', async () => {
        const { writeReturningHint, recordSessionLossIfSuspicious, takePendingSessionLoss } = await load();

        writeReturningHint(true);
        recordSessionLossIfSuspicious();
        await flush();

        const evidence = takePendingSessionLoss();
        expect(evidence).not.toBeNull();
        expect(evidence!.returningHint).toBe(true);
        expect(evidence!.authKeyInLocalStorage).toBe(false);
        expect(typeof evidence!.at).toBe('string');
    });

    it('저장소가 통째로 비워졌는지 가릴 수 있게 살아남은 앱 키 수를 함께 남긴다', async () => {
        const { writeReturningHint, recordSessionLossIfSuspicious, takePendingSessionLoss } = await load();

        writeReturningHint(true);
        localStorage.setItem('tmap_geo_cache_v1', '[]');
        localStorage.setItem('preferred-nav-app', 'tmap');
        localStorage.setItem('firebase:authUser:key:[DEFAULT]', '{}');

        recordSessionLossIfSuspicious();
        await flush();

        const evidence = takePendingSessionLoss();
        // 힌트 + tmap 캐시 + 내비 설정 = 3개 (firebase 키는 우리 앱 키가 아니다)
        expect(evidence!.survivingAppKeys).toBe(3);
        // Firebase 세션 키가 남아 있는데 로그인이 안 됐다면 저장소 소실이 아닌 다른 원인이다
        expect(evidence!.authKeyInLocalStorage).toBe(true);
    });

    it('꺼낸 증거는 지운다 — 같은 건이 다음 로그인마다 반복 보고되지 않게', async () => {
        const { writeReturningHint, recordSessionLossIfSuspicious, takePendingSessionLoss } = await load();

        writeReturningHint(true);
        recordSessionLossIfSuspicious();
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

    it('힌트를 읽는 것은 동기다 — 호출자가 곧바로 힌트를 내려도 판정이 뒤집히지 않는다', async () => {
        const { writeReturningHint, recordSessionLossIfSuspicious, takePendingSessionLoss } = await load();

        writeReturningHint(true);
        recordSessionLossIfSuspicious();
        writeReturningHint(false); // main.tsx가 바로 다음 줄에서 하는 일
        await flush();

        expect(takePendingSessionLoss()).not.toBeNull();
    });

    it('저장소가 막혀 있어도 부팅을 막지 않는다', async () => {
        const { writeReturningHint, recordSessionLossIfSuspicious } = await load();

        writeReturningHint(true);
        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('QuotaExceededError');
        });

        expect(() => recordSessionLossIfSuspicious()).not.toThrow();
        await flush();

        setItem.mockRestore();
    });
});
