import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, browserLocalPersistence, setPersistence } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache, getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
// firebase/analytics, firebase/app-check, firebase/messaging은 동적 import (번들 최적화)

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
    import('firebase/analytics').then(({ getAnalytics }) => {
        _analytics = getAnalytics(app);
    }).catch(() => { /* Analytics 로드 실패 무시 */ });
}

// === App Check 지연 초기화 (초기 번들에서 ~30KB 제외) ===
function initAppCheckLazy() {
    const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;
    if (!recaptchaSiteKey) {
        console.warn('[AppCheck] VITE_RECAPTCHA_ENTERPRISE_SITE_KEY 미설정 — App Check 비활성화');
        return;
    }
    // 개발 환경에서 디버그 토큰 사용 (Firebase Console → App Check → 디버그 토큰 등록 필요)
    if (import.meta.env.DEV) {
        (self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;
    }
    import('firebase/app-check').then(({ initializeAppCheck, ReCaptchaEnterpriseProvider }) => {
        initializeAppCheck(app, {
            provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey),
            isTokenAutoRefreshEnabled: true,
        });
    }).catch((err) => {
        console.warn('[AppCheck] 초기화 실패:', err);
    });
}

// 브라우저 유휴 시점에 Analytics + AppCheck 초기화 (메인 스레드 미차단)
const scheduleIdle = typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : (cb: () => void) => setTimeout(cb, 100);
scheduleIdle(() => {
    initAppCheckLazy();
    initAnalyticsLazy();
});

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
        msg.includes('The node to be removed is not a child of this node')
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

if (typeof window !== 'undefined') {
    window.addEventListener('error', (event) => {
        if (isFirestorePersistenceError(event?.message)) {
            console.warn('[Firestore] 지속성 에러 억제:', event.message);
            showQuotaAlert(event?.message || '');
            event.preventDefault();
            return true;
        }
    });
    window.addEventListener('unhandledrejection', (event) => {
        const msg = event?.reason?.message || String(event?.reason || '');
        if (isFirestorePersistenceError(msg)) {
            console.warn('[Firestore] 지속성 에러 억제:', msg);
            showQuotaAlert(msg);
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
        console.warn('[Firestore] IndexedDB 사용 불가 → memoryLocalCache로 재초기화');
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
