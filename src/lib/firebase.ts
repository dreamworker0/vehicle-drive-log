import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, browserLocalPersistence, setPersistence } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache, getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
// firebase/messaging? getMessagingInstance()?먯꽌 ?숈쟻 import (踰덈뱾 理쒖쟻??

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
// iOS Safari ITP 대응: 명시적으로 local persistence 설정하여 세션 유지 보장
setPersistence(auth, browserLocalPersistence).catch((err) =>
    console.warn('[Auth] persistence 설정 실패:', err)
);

// IndexedDB / Firestore 鍮꾨룞湲??먮윭 ?⑦꽩 (Sentry ?몄씠利?諛⑹?)
function isFirestorePersistenceError(msg: string) {
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
            console.warn('[Firestore] 吏?띿꽦 ?먮윭 ?듭젣:', event.message);
            event.preventDefault();
            return true;
        }
    });
    window.addEventListener('unhandledrejection', (event) => {
        const msg = event?.reason?.message || String(event?.reason || '');
        if (isFirestorePersistenceError(msg)) {
            console.warn('[Firestore] 吏?띿꽦 ?먮윭 ?듭젣:', msg);
            event.preventDefault();
        }
        // permission-denied ?먮윭??useAuth??onSnapshot?먯꽌 ?ъ떆??濡쒓렇?꾩썐?쇰줈
        // ?대? 泥섎━?섎?濡?unhandledrejection?쇰줈 Sentry??以묐났 由ы룷?몃릺吏 ?딅룄濡??듭젣
        if (event?.reason?.code === 'permission-denied' || msg.includes('Missing or insufficient permissions')) {
            console.warn('[Firestore] 沅뚰븳 ?먮윭 ?듭젣 (??濡쒖쭅?먯꽌 泥섎━??:', msg);
            event.preventDefault();
        }
    });
}

// IndexedDB 媛?⑹꽦 ?ъ쟾 寃??(?꾨씪?대퉿 紐⑤뱶, ?먯긽???ㅽ넗由ъ? ??媛먯?)
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
            // ?쇰? ?섍꼍?먯꽌??onblocked媛 諛쒖깮
            testRequest.onblocked = () => resolve(false);
            // ??꾩븘??(2珥??대궡 ?묐떟 ?놁쑝硫?遺덇? ?먯젙)
            setTimeout(() => resolve(false), 2000);
        });
    } catch {
        return false;
    }
}

// Firestore 珥덇린??(?숆린 ?쒕룄 ??鍮꾨룞湲?IndexedDB 寃利????꾩슂 ???ъ큹湲고솕)
let db: ReturnType<typeof getFirestore>;

function initFirestoreSync() {
    try {
        return initializeFirestore(app, {
            localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
        });
    } catch (err) {
        const errObj = err as { message?: string; code?: string };
        const errMsg = errObj?.message || '';
        if (errObj?.code === 'failed-precondition' || errMsg.includes('already initialized')) {
            return getFirestore(app);
        }
        console.warn('[Firestore] persistent 珥덇린???ㅽ뙣, memoryLocalCache ?대갚:', err);
        try {
            return initializeFirestore(app, { localCache: memoryLocalCache() });
        } catch {
            try { return getFirestore(app); } catch { return null; }
        }
    }
}

// 1?④퀎: ?숆린?곸쑝濡?癒쇱? 珥덇린??(?섏씠吏 濡쒕뱶 利됱떆 ?ъ슜 媛??
db = initFirestoreSync()!;

// 2?④퀎: 鍮꾨룞湲곕줈 IndexedDB 寃利????ъ슜 遺덇? ??memoryLocalCache濡??ъ큹湲고솕
checkIndexedDBAvailability().then((available) => {
    if (!available && db) {
        console.warn('[Firestore] IndexedDB ?ъ슜 遺덇? ??memoryLocalCache濡??ъ큹湲고솕');
        try {
            db = initializeFirestore(app, { localCache: memoryLocalCache() });
        } catch {
            // ?대? 珥덇린?붾맂 寃쎌슦 湲곗〈 ?몄뒪?댁뒪 ?좎? (?먮윭??湲濡쒕쾶 ?몃뱾?ш? ?듭젣)
            db = getFirestore(app);
        }
    }
    return db;
});

export { db };
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

// FCM ??釉뚮씪?곗? 吏???쒖뿉留?珥덇린??(?숈쟻 import濡?踰덈뱾 理쒖쟻??
let _messaging: any = null;
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
