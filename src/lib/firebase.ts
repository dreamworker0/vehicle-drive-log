import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, connectAuthEmulator } from 'firebase/auth';
import { authReady as _authReady } from './firebaseAuth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache, getFirestore, clearIndexedDbPersistence, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { initializeAppCheck, ReCaptchaV3Provider, onTokenChanged } from 'firebase/app-check';
import { isInAppBrowser } from './inAppBrowser';
import { notifyUser } from './notify';
// firebase/analytics, firebase/messaging은 동적 import (번들 최적화)

// === E2E/로컬 에뮬레이터 모드 ===
// VITE_USE_EMULATOR=true 일 때만 Auth/Firestore/Functions 에뮬레이터에 연결하고
// App Check를 비활성화한다. 빌드 타임 치환되는 환경변수이므로 프로덕션 빌드(false)에서는
// 아래 분기들이 dead code로 제거되어 기존 동작과 100% 동일하다.
const USE_EMULATOR = import.meta.env.VITE_USE_EMULATOR === 'true';

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);

// === App Check 초기화 (initializeApp 직후, 다른 서비스보다 먼저) ===
// 개발 환경: VITE_APPCHECK_DEBUG_TOKEN으로 에뮬레이터/로컬 통과
// 프로덕션: reCAPTCHA v3 토큰 자동 발급
if (typeof window !== 'undefined' && !USE_EMULATOR && !isInAppBrowser()) {
    // @firebase/app-check / @firebase/auth SDK 내부 logger가 토큰 교환 500/throttle 시
    // console.warn을 N회 직접 호출한다 (per-component setLogLevel 미제공). 우리 쪽
    // onTokenChanged 핸들러에서 이미 60초 dedup으로 1회 안내하므로, 동일한 의미의
    // SDK 내부 경고만 좁게 필터링한다. 전역 setLogLevel은 다른 진단 경고까지 막아 부적합.
    const origWarn = console.warn.bind(console);
    const appCheckNoisePatterns = [
        '@firebase/app-check',
        'Error while retrieving App Check token',
    ];
    const appCheckNoiseCodes = [
        'appCheck/throttled',
        'appCheck/initial-throttle',
        'AppCheck: 500 error',
        'Requests throttled due to previous',
    ];
    console.warn = (...args: unknown[]) => {
        // @firebase/logger는 prefix("[ts]  @firebase/xxx:")를 args[0]에,
        // 실제 메시지(코드 포함)를 args[1]+에 넣어 호출한다. 따라서 두 패턴을
        // 같은 인자에서 찾으면 안 되고, args 전체를 합쳐서 본다.
        const combined = args.map(a => (typeof a === 'string' ? a : '')).join(' ');
        if (
            appCheckNoisePatterns.some(p => combined.includes(p)) &&
            appCheckNoiseCodes.some(c => combined.includes(c))
        ) {
            return;
        }
        origWarn(...args);
    };
    const debugToken = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN;
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (debugToken && isLocalhost) {
        // @ts-expect-error -- 글로벌 디버그 토큰 설정 (firebase 공식 방법)
        self.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
    }
    
    let appCheck;
    // @ts-expect-error -- HMR 및 중복 실행 시 reCAPTCHA 중복 렌더링 에러 방지
    if (!window.__APP_CHECK_INITIALIZED__) {
        appCheck = initializeAppCheck(app, {
            provider: new ReCaptchaV3Provider(import.meta.env.VITE_RECAPTCHA_SITE_KEY),
            isTokenAutoRefreshEnabled: true,
        });
        // @ts-expect-error -- window.__APP_CHECK_INITIALIZED__ 속성 할당 허용
        window.__APP_CHECK_INITIALIZED__ = appCheck;
    } else {
        // @ts-expect-error -- window.__APP_CHECK_INITIALIZED__ 속성 참조 허용
        appCheck = window.__APP_CHECK_INITIALIZED__;
    }

    // App Check 내부 에러(500 에러 등) — 동일 errorCode 기준 60초 윈도우에 1회만 출력
    const appCheckWarnDedup = new Map<string, number>();
    onTokenChanged(appCheck, {
        next: () => { /* 정상 토큰 발급 시 무시 */ },
        error: (err) => {
            const code = (err as { code?: string })?.code || 'unknown';
            const now = Date.now();
            const last = appCheckWarnDedup.get(code) ?? 0;
            if (now - last < 60_000) return;
            appCheckWarnDedup.set(code, now);
            const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
            console.warn(
                `[App Check] 토큰 발급 실패 (${code}) — ${isLocalhost ? '로컬' : '인프라/네트워크'} 이슈로 간주:`,
                err
            );
        }
    });
}

// === Analytics 지연 초기화 (초기 번들에서 ~20KB 제외) ===
let _analytics: ReturnType<typeof import('firebase/analytics').getAnalytics> | null = null;
function initAnalyticsLazy() {
    if (typeof window === 'undefined' || import.meta.env.MODE === 'test') return;
    import('firebase/analytics').then(({ getAnalytics }) => {
        _analytics = getAnalytics(app);
    }).catch(() => { /* Analytics 로드 실패 무시 */ });
}

// 브라우저 유휴 시점에 Analytics 초기화 (메인 스레드 미차단)
const scheduleIdle = typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : (cb: () => void) => setTimeout(cb, 100);
scheduleIdle(() => {
    initAnalyticsLazy();
});

export const auth = getAuth(app);
// 에뮬레이터 모드: Auth 에뮬레이터(9099)에 연결 (E2E 인증 세션용).
// firebaseAuth.ts에서 이미 연결됐을 수 있으므로 emulatorConfig 유무로 중복 연결을 가드한다.
if (USE_EMULATOR && typeof window !== 'undefined' && !(auth as unknown as { emulatorConfig?: unknown }).emulatorConfig) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
}
// main.tsx → firebaseAuth.ts에서 이미 setPersistence 완료.
// 중복 호출 대신 기존 Promise를 재수출하여 ~200-500ms 절감.
export const authReady = _authReady;

// IndexedDB / Firestore 비동기 에러 억제 (Sentry 노이즈 방지)
function isFirestorePersistenceError(msg: string) {
    if (!msg) return false;
    return (
        msg.includes('INTERNAL ASSERTION FAILED') ||
        msg.includes('QuotaExceededError') ||
        msg.includes('Encountered full disk') ||
        msg.includes('Failed to obtain exclusive access') ||
        msg.includes('Internal error opening backing store') ||
        msg.includes('indexedDB.open') ||
        (msg.includes('AbortError') && !msg.includes('fetch')) ||
        msg.includes('UnknownError') ||
        msg.includes('Failed to delete record from object store') ||
        msg.includes("Cannot read properties of null (reading 'Te')") ||
        msg.includes('mutating the [[Prototype]]') ||
        msg.includes('A mutation operation was attempted on a database that did not allow mutations') ||
        msg.includes('The object can not be found here') ||
        msg.includes('The node to be removed is not a child of this node') ||
        msg.includes('BloomFilter') ||
        msg.includes('BloomFilterError')
    );
}

// QuotaExceeded 전용: 사용자가 저장공간을 확보하도록 1회만 안내
let quotaAlertShown = false;
function showQuotaAlert(msg: string) {
    if (quotaAlertShown) return;
    if (msg.includes('QuotaExceededError') || msg.includes('Encountered full disk')) {
        quotaAlertShown = true;
        notifyUser('기기 저장공간이 부족합니다. 불필요한 앱이나 파일을 삭제한 후 다시 시도해주세요.', 'error', 12000);
    }
}

function isCacheCorruptionError(msg: string) {
    if (!msg) return false;
    return (
        msg.includes('Failed to obtain exclusive access') ||
        msg.includes('Internal error opening backing store') ||
        msg.includes('A mutation operation was attempted on a database that did not allow mutations') ||
        msg.includes('BloomFilter') ||
        msg.includes('BloomFilterError') ||
        msg.includes('indexedDB.open')
    );
}

let isRecoveringCache = false;
async function attemptCacheRecovery() {
    if (isRecoveringCache || typeof window === 'undefined') return;
    isRecoveringCache = true;
    console.warn('[Firestore] 로컬 캐시 꼬임 감지. 자동 복구를 시작합니다.');
    try {
        if (typeof db !== 'undefined' && db) {
            await clearIndexedDbPersistence(db);
        }
        console.warn('[Firestore] 복구 완료. 페이지를 새로고침합니다.');
        if (!sessionStorage.getItem('firestore_recovered')) {
            sessionStorage.setItem('firestore_recovered', 'true');
            window.location.reload();
        } else {
            notifyUser('오프라인 데이터 로딩 중 지속적인 문제가 발생하고 있습니다. 브라우저 방문 기록(캐시 및 쿠키)을 비운 후 다시 시도해주세요.', 'error', 12000);
            sessionStorage.removeItem('firestore_recovered');
        }
    } catch (err) {
        console.error('[Firestore] 캐시 자동 복구 실패:', err);
    } finally {
        isRecoveringCache = false;
    }
}

if (typeof window !== 'undefined') {
    window.addEventListener('error', (event) => {
        const msg = event?.message || '';
        if (isFirestorePersistenceError(msg)) {
            console.warn('[Firestore] 지속성 에러 억제:', msg);
            if (isCacheCorruptionError(msg)) {
                attemptCacheRecovery();
            } else {
                showQuotaAlert(msg);
            }
            event.preventDefault();
            return true;
        }
    });
    window.addEventListener('unhandledrejection', (event) => {
        const msg = event?.reason?.message || String(event?.reason || '');
        if (isFirestorePersistenceError(msg)) {
            console.warn('[Firestore] 지속성 에러 억제:', msg);
            if (isCacheCorruptionError(msg)) {
                attemptCacheRecovery();
            } else {
                showQuotaAlert(msg);
            }
            event.preventDefault();
        }
        // permission-denied 에러는 useAuth의 onSnapshot에서 재시도/로그아웃으로
        // 이미 처리되므로 unhandledrejection으로 Sentry에 중복 리포트되지 않도록 억제
        if (event?.reason?.code === 'permission-denied' || msg.includes('Missing or insufficient permissions')) {
            console.warn('[Firestore] 권한 에러 억제 (앱 로직에서 처리됨):', msg);
            event.preventDefault();
        }
    });
}

// IndexedDB 가용성 사전 검사 (프라이빗 모드, 비정상 스토리지 등 감지)
async function checkIndexedDBAvailability() {
    if (typeof window === 'undefined' || !window.indexedDB) return false;
    try {
        const testRequest = window.indexedDB.open('__idb_test__');
        return await new Promise((resolve) => {
            testRequest.onsuccess = () => {
                testRequest.result.close();
                window.indexedDB.deleteDatabase('__idb_test__');
                resolve(true);
            };
            testRequest.onerror = () => resolve(false);
            // 일부 환경에서는 onblocked가 발생
            testRequest.onblocked = () => resolve(false);
            // 타임아웃 (2초 이내 응답 없으면 불가 판정)
            setTimeout(() => resolve(false), 2000);
        });
    } catch {
        return false;
    }
}

// Firestore 초기화 (동기 시도 후 비동기 IndexedDB 검사 필요 시 재초기화)
let db: ReturnType<typeof getFirestore>;

function initFirestoreSync() {
    try {
        // 에뮬레이터 모드: 메모리 캐시 + Firestore 에뮬레이터(8080) 연결.
        // 테스트 간 IndexedDB 캐시 오염을 피하기 위해 memoryLocalCache 사용.
        if (USE_EMULATOR) {
            const instance = initializeFirestore(app, { localCache: memoryLocalCache() });
            connectFirestoreEmulator(instance, '127.0.0.1', 8080);
            return instance;
        }
        if (typeof window === 'undefined') {
            return initializeFirestore(app, { localCache: memoryLocalCache() });
        }
        return initializeFirestore(app, {
            localCache: persistentLocalCache({
                cacheSizeBytes: 25 * 1024 * 1024, // 25MB 제한 (저사양 기기 QuotaExceeded 예방)
                tabManager: persistentMultipleTabManager(),
            }),
        });
    } catch (err) {
        const errObj = err as { message?: string; code?: string };
        const errMsg = errObj?.message || '';
        if (errObj?.code === 'failed-precondition' || errMsg.includes('already initialized')) {
            return getFirestore(app);
        }
        console.warn('[Firestore] persistent 초기화 실패, memoryLocalCache 대체:', err);
        try {
            return initializeFirestore(app, { localCache: memoryLocalCache() });
        } catch {
            try { return getFirestore(app); } catch { return null; }
        }
    }
}

// 1단계: 동기적으로 먼저 초기화 (페이지 로드 즉시 사용 가능)
db = initFirestoreSync()!;

// 2단계: 비동기로 IndexedDB 검사 후 사용 불가 시 memoryLocalCache로 재초기화
// (에뮬레이터 모드는 이미 memory 캐시 + 에뮬레이터 연결 상태이므로 재초기화 스킵)
checkIndexedDBAvailability().then((available) => {
    if (USE_EMULATOR) return db;
    if (!available && db) {
        if (typeof window !== 'undefined') {
            console.warn('[Firestore] IndexedDB 사용 불가 → memoryLocalCache로 재초기화');
        }
        try {
            db = initializeFirestore(app, { localCache: memoryLocalCache() });
        } catch {
            // 이미 초기화된 경우 기존 인스턴스 유지 (에러를 글로벌 핸들러에서 억제)
            db = getFirestore(app);
        }
    }
    return db;
});

export { db };
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
export const firebaseFunctions = getFunctions(app, 'asia-northeast3');
// 에뮬레이터 모드: Functions 에뮬레이터(5001)에 연결
if (USE_EMULATOR && typeof window !== 'undefined') {
    connectFunctionsEmulator(firebaseFunctions, '127.0.0.1', 5001);
}

// FCM은 브라우저 지원 시에만 초기화 (동적 import로 번들 최적화)
let _messaging: ReturnType<typeof import('firebase/messaging').getMessaging> | null = null;
let _messagingInit = false;

export async function getMessagingInstance() {
    if (_messagingInit) return _messaging;
    _messagingInit = true;
    try {
        const { getMessaging, isSupported } = await import('firebase/messaging');
        const supported = await isSupported();
        _messaging = supported ? getMessaging(app) : null;
    } catch {
        _messaging = null;
    }
    return _messaging;
}

export function getAnalyticsInstance() { return _analytics; }

// === E2E 전용 로그인 헬퍼 ===
// 에뮬레이터 모드에서만 window에 노출한다. Google 로그인 전용 앱이라 Playwright로
// OAuth 팝업을 자동화할 수 없으므로, Auth 에뮬레이터의 이메일/비밀번호 계정으로
// 로그인하는 헬퍼를 제공해 인증 후 화면 E2E를 가능하게 한다. (프로덕션 빌드에선 제거됨)
if (USE_EMULATOR && typeof window !== 'undefined') {
    import('firebase/auth').then(({ signInWithEmailAndPassword, signOut }) => {
        (window as unknown as Record<string, unknown>).__E2E_AUTH__ = {
            signIn: (email: string, password: string) => signInWithEmailAndPassword(auth, email, password),
            signOut: () => signOut(auth),
        };
    });
}

export default app;
