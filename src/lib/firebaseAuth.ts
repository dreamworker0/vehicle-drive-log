/**
 * firebaseAuth.ts — Auth 전용 경량 모듈
 *
 * main.tsx와 lightEntry.tsx에서 사용하는 최소한의 Firebase Auth 초기화.
 * firebase.ts와 달리 Firestore, Storage, Analytics, AppCheck를 로드하지 않음.
 *
 * ⚠️ 이 모듈은 경량 경로(비인증 사용자)에서만 사용해야 함.
 * 인증 후 전체 앱에서는 반드시 firebase.ts의 auth를 사용할 것.
 *
 * ⚠️ setPersistence를 호출하지 않는다.
 * browserLocalPersistence(IndexedDB)가 이미 기본값이므로 중복 호출하면
 * getAuth()의 초기 세션 복원과 경쟁하여 새 탭에서 세션을 못 읽는 버그가 생긴다.
 * iOS Safari ITP 대응 setPersistence는 전체 앱(firebase.ts)에서 처리한다.
 */
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

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
export const auth = getAuth(app);
// 호환성: main.tsx에서 authReady.then() 패턴 유지
export const authReady = Promise.resolve();

