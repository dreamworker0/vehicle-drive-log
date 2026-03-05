import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache, getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
// firebase/messaging은 getMessagingInstance()에서 동적 import (번들 최적화)

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

// IndexedDB / Firestore 비동기 에러 패턴 (Sentry 노이즈 방지)
function isFirestorePersistenceError(msg) {
    if (!msg) return false;
    return (
        msg.includes('INTERNAL ASSERTION FAILED') ||
        msg.includes('Failed to obtain exclusive access') ||
        msg.includes('Internal error opening backing store') ||
        msg.includes('indexedDB.open') ||
        (msg.includes('AbortError') && !msg.includes('fetch')) ||
        msg.includes('UnknownError') ||
        msg.includes("Cannot read properties of null (reading 'Te')") ||
        msg.includes('mutating the [[Prototype]]') ||
        msg.includes('A mutation operation was attempted on a database that did not allow mutations')
    );
}

if (typeof window !== 'undefined') {
    window.addEventListener('error', (event) => {
        if (isFirestorePersistenceError(event?.message)) {
            console.warn('[Firestore] 지속성 에러 억제:', event.message);
            event.preventDefault();
            return true;
        }
    });
    window.addEventListener('unhandledrejection', (event) => {
        const msg = event?.reason?.message || String(event?.reason || '');
        if (isFirestorePersistenceError(msg)) {
            console.warn('[Firestore] 지속성 에러 억제:', msg);
            event.preventDefault();
        }
        // permission-denied 에러는 useAuth의 onSnapshot에서 재시도/로그아웃으로
        // 이미 처리하므로 unhandledrejection으로 Sentry에 중복 리포트되지 않도록 억제
        if (event?.reason?.code === 'permission-denied' || msg.includes('Missing or insufficient permissions')) {
            console.warn('[Firestore] 권한 에러 억제 (앱 로직에서 처리됨):', msg);
            event.preventDefault();
        }
    });
}

// IndexedDB 가용성 사전 검사 (프라이빗 모드, 손상된 스토리지 등 감지)
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

// Firestore 초기화 (동기 시도 → 비동기 IndexedDB 검증 후 필요 시 재초기화)
let db;
let _dbReady;

function initFirestoreSync() {
    try {
        return initializeFirestore(app, {
            localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
        });
    } catch (err) {
        const errMsg = err?.message || '';
        if (err?.code === 'failed-precondition' || errMsg.includes('already initialized')) {
            return getFirestore(app);
        }
        console.warn('[Firestore] persistent 초기화 실패, memoryLocalCache 폴백:', err);
        try {
            return initializeFirestore(app, { localCache: memoryLocalCache() });
        } catch {
            try { return getFirestore(app); } catch { return null; }
        }
    }
}

// 1단계: 동기적으로 먼저 초기화 (페이지 로드 즉시 사용 가능)
db = initFirestoreSync();

// 2단계: 비동기로 IndexedDB 검증 → 사용 불가 시 memoryLocalCache로 재초기화
_dbReady = checkIndexedDBAvailability().then((available) => {
    if (!available && db) {
        console.warn('[Firestore] IndexedDB 사용 불가 — memoryLocalCache로 재초기화');
        try {
            db = initializeFirestore(app, { localCache: memoryLocalCache() });
        } catch {
            // 이미 초기화된 경우 기존 인스턴스 유지 (에러는 글로벌 핸들러가 억제)
            db = getFirestore(app);
        }
    }
    return db;
});

export { db, _dbReady };
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

// FCM — 브라우저 지원 시에만 초기화 (동적 import로 번들 최적화)
let _messaging = null;
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

export default app;
