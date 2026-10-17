/**
 * 에뮬레이터 모드(VITE_USE_EMULATOR=true)에서 Analytics·Messaging(FCM)을 초기화하지 않는지 검증한다.
 *
 * 두 서비스는 에뮬레이터가 없어 초기화만으로 실제 Google 서버에 요청이 나간다
 * (Analytics 설정 조회, Installations 등록, FCM 토큰 발급). CI의 인증 E2E는 실제 키로 돌므로
 * 막지 않으면 테스트 실행이 운영 Analytics에 집계된다. 대조군으로 에뮬레이터가 아닐 때는
 * 기존처럼 초기화되는지도 함께 확인한다 — 운영 동작이 바뀌지 않았다는 근거다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { getAnalytics, getMessaging, isSupported } = vi.hoisted(() => ({
    getAnalytics: vi.fn(() => ({ analytics: true })),
    getMessaging: vi.fn(() => ({ messaging: true })),
    isSupported: vi.fn().mockResolvedValue(true),
}));

vi.mock('firebase/analytics', () => ({ getAnalytics }));
vi.mock('firebase/messaging', () => ({ getMessaging, isSupported }));

vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
    getAuth: vi.fn(() => ({})),
    connectAuthEmulator: vi.fn(),
    GoogleAuthProvider: class { setCustomParameters() { } },
    signInWithEmailAndPassword: vi.fn(),
    signOut: vi.fn(),
}));
vi.mock('../../lib/firebaseAuth', () => ({ authReady: Promise.resolve() }));
vi.mock('firebase/firestore', () => ({
    initializeFirestore: vi.fn(() => ({})),
    persistentLocalCache: vi.fn(),
    persistentMultipleTabManager: vi.fn(),
    memoryLocalCache: vi.fn(),
    getFirestore: vi.fn(() => ({})),
    clearIndexedDbPersistence: vi.fn().mockResolvedValue(undefined),
    terminate: vi.fn().mockResolvedValue(undefined),
    connectFirestoreEmulator: vi.fn(),
}));
vi.mock('firebase/storage', () => ({ getStorage: vi.fn(() => ({})) }));
vi.mock('firebase/functions', () => ({
    getFunctions: vi.fn(() => ({})),
    connectFunctionsEmulator: vi.fn(),
}));

/** 환경을 정한 뒤 lib/firebase를 새로 불러온다(USE_EMULATOR는 모듈 평가 시점에 읽힌다). */
async function loadFirebase(useEmulator: boolean) {
    vi.stubEnv('VITE_USE_EMULATOR', useEmulator ? 'true' : 'false');
    // Analytics는 MODE === 'test'에서도 건너뛰므로, 에뮬레이터 가드만 보도록 MODE를 바꾼다.
    vi.stubEnv('MODE', useEmulator ? 'emulator' : 'development');
    const mod = await import('../../lib/firebase');
    // 유휴 콜백 안의 import('firebase/analytics')가 끝날 때까지 기다린다
    await vi.dynamicImportSettled();
    return mod;
}

describe('lib/firebase 에뮬레이터 모드', () => {
    const originalWarn = console.warn;

    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        // 유휴 시점 초기화를 즉시 실행해 Analytics 초기화 여부를 바로 확인한다
        vi.stubGlobal('requestIdleCallback', (cb: () => void) => { cb(); return 0; });
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
        // 에뮬레이터가 아닌 경로는 App Check 경고 필터로 console.warn을 갈아 끼운다
        console.warn = originalWarn;
    });

    it('에뮬레이터 모드에서는 Analytics를 초기화하지 않는다', async () => {
        const { getAnalyticsInstance } = await loadFirebase(true);

        expect(getAnalytics).not.toHaveBeenCalled();
        expect(getAnalyticsInstance()).toBeNull();
    });

    it('에뮬레이터 모드에서는 Messaging을 초기화하지 않는다', async () => {
        const { getMessagingInstance } = await loadFirebase(true);

        await expect(getMessagingInstance()).resolves.toBeNull();
        expect(isSupported).not.toHaveBeenCalled();
        expect(getMessaging).not.toHaveBeenCalled();
    });

    it('에뮬레이터 모드가 아니면 Analytics·Messaging을 기존처럼 초기화한다', async () => {
        const { getAnalyticsInstance, getMessagingInstance } = await loadFirebase(false);

        expect(getAnalytics).toHaveBeenCalledTimes(1);
        expect(getAnalyticsInstance()).toEqual({ analytics: true });
        await expect(getMessagingInstance()).resolves.toEqual({ messaging: true });
        expect(getMessaging).toHaveBeenCalledTimes(1);
    });
});
