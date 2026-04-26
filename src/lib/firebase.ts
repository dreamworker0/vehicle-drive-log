import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, browserLocalPersistence, setPersistence } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache, getFirestore, clearIndexedDbPersistence } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
// firebase/analytics, firebase/messaging은 동적 import (번들 최적화)

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

// === Analytics 지연 초기화 (초기 번들에서 ~20KB 제외) ===
let _analytics: ReturnType<typeof import('firebase/analytics').getAnalytics> | null = null;
function initAnalyticsLazy() {
    if (typeof window === 'undefined') return;
    import('firebase/analytics').then(({ getAnalytics }) => {
        _analytics = getAnalytics(app);
    }).catch(() => { /* Analytics 로드 실패 무시 */ });
}

// === App Check 동기 초기화 (Firebase 쿼리 전 토큰 확보 보장) ===
function initAppCheck() {
    if (typeof window === 'undefined') return;
    const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;
    if (!recaptchaSiteKey) {
        console.warn('[AppCheck] VITE_RECAPTCHA_ENTERPRISE_SITE_KEY 미설정 — App Check 비활성화');
        return;
    }
    // 개발 환경에서 디버그 토큰 사용 (Firebase Console → App Check → 디버그 토큰 등록 필요)
    if (import.meta.env.DEV) {
        if (!import.meta.env.VITE_APPCHECK_DEBUG_TOKEN) {
            console.warn('[AppCheck] VITE_APPCHECK_DEBUG_TOKEN이 환경변수에 없습니다. App Check로 인해 로컬 Firestore 접근이 제한될 수 있습니다.');
        }
        (self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;
    }
    try {
        initializeAppCheck(app, {
            provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey),
            isTokenAutoRefreshEnabled: true,
        });
        console.info('[AppCheck] 초기화 완료');
    } catch (err) {
        console.warn('[AppCheck] 초기화 실패:', err);
    }
}

// 브라우저 유휴 시점에 Analytics 초기화 (메인 스레드 미차단)
const scheduleIdle = typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : (cb: () => void) => setTimeout(cb, 100);
scheduleIdle(() => {
    initAnalyticsLazy();
});

// 첫 데이터 요청 전 가능한 빠르게 토큰을 확보하기 위해 즉시 비동기 실행
initAppCheck();

export const auth = getAuth(app);
// iOS Safari ITP 대응: 명시적으로 local persistence 설정하여 세션 유지 보장
// useAuth에서 await하여 persistence 설정 완료 후 onAuthStateChanged 구독을 시작한다.
export const authReady = setPersistence(auth, browserLocalPersistence).catch((err) => {
    console.warn('[Auth] persistence 설정 실패:', err);
});

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
        // eslint-disable-next-line no-restricted-globals -- 비-React 모듈이라 useToast 사용 불가, 저장공간 부족 시 유일한 알림 수단
        alert('기기 저장공간이 부족합니다.\n불필요한 앱이나 파일을 삭제한 후 다시 시도해주세요.');
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
            // eslint-disable-next-line no-restricted-globals
            alert('오프라인 데이터 로딩 중 지속적인 문제가 발생하고 있습니다.\n브라우저 방문 기록(캐시 및 쿠키)을 비운 후 다시 시도해주세요.');
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
        // App Check reCAPTCHA 타임아웃 (구형 브라우저·느린 네트워크 환경 이슈, 앱 버그 아님)
        if (/reCAPTCHA.*(Timeout|timeout)/.test(msg)) {
            console.warn('[AppCheck] reCAPTCHA 타임아웃 억제:', msg);
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
checkIndexedDBAvailability().then((available) => {
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
export default app;
