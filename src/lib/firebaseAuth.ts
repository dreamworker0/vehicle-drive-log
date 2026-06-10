/**
 * firebaseAuth.ts — Auth 전용 경량 모듈
 *
 * main.tsx와 lightEntry.tsx에서 사용하는 최소한의 Firebase Auth 초기화.
 * firebase.ts와 달리 Firestore, Storage, Analytics, AppCheck를 로드하지 않음.
 *
 * ⚠️ 이 모듈은 경량 경로(비인증 사용자)에서만 사용해야 함.
 * 인증 후 전체 앱에서는 반드시 firebase.ts의 auth를 사용할 것.
 *
 * ⚠️ setPersistence(browserLocalPersistence) 호출이 필수.
 * 이를 호출하지 않으면 main.tsx에서 authReady가 즉시 resolve되어
 * onAuthStateChanged 첫 콜백 시점에 IndexedDB 세션 복원이 완료되지 않아
 * user=null로 판단 → 새 탭에서 로그아웃되는 버그가 발생한다.
 * iOS Safari ITP 대응도 이 호출로 처리된다.
 */
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, initializeAuth, browserLocalPersistence, indexedDBLocalPersistence, setPersistence, connectAuthEmulator } from 'firebase/auth';

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// 이미 초기화된 앱이 있으면 재사용 (appEntry에서 firebase.ts 로드 시 충돌 방지)
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
// Service Worker 등 window 없는 컨텍스트: getAuth 기본 persistence 스택의
// browserLocalPersistence가 window.localStorage 폴러를 돌려 ReferenceError를
// 반복 발생시키므로, indexedDB 전용으로 초기화한다 (Firebase 공식 SW 패턴)
const isWindowContext = typeof window !== 'undefined';
export const auth = isWindowContext
    ? getAuth(app)
    : initializeAuth(app, { persistence: indexedDBLocalPersistence });
// 에뮬레이터 모드(E2E): 경량 경로(main.tsx)에서도 auth가 가장 먼저 사용되므로
// 여기서 에뮬레이터에 연결해야 onAuthStateChanged가 에뮬레이터 세션을 본다.
// firebase.ts와 동일 인스턴스를 공유하므로 emulatorConfig 유무로 중복 연결을 가드한다.
if (
    import.meta.env.VITE_USE_EMULATOR === 'true' &&
    typeof window !== 'undefined' &&
    !(auth as unknown as { emulatorConfig?: unknown }).emulatorConfig
) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
}
// setPersistence 완료를 기다려야 새 탭에서 IndexedDB 세션 복원이 보장됨
// (window 없는 컨텍스트는 위에서 indexedDB persistence로 이미 초기화 완료)
export const authReady = isWindowContext
    ? setPersistence(auth, browserLocalPersistence).catch((err) => {
        console.warn('[Auth] persistence 설정 실패:', err);
    })
    : Promise.resolve();

