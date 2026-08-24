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
//
// ## authStateReady()를 이어 붙인 이유 — 이전(migration) 구간을 관측하지 않게 한다
//
// `getAuth()`는 기본 persistence 스택 `[IndexedDB, localStorage, sessionStorage]`로 초기화된다
// (IndexedDB가 1순위). 그 뒤에 부르는 `setPersistence(browserLocalPersistence)`는 단순 설정
// 변경이 아니라 **이전**이다 — 세션이 IndexedDB에 있으면 읽어서 **지우고**(removeCurrentUser)
// localStorage에 다시 쓴다. 프로덕션 스택 트레이스로 확인했다:
//   setPersistence → removeCurrentUser → _remove → _withPendingWrite → IndexedDB
//
// 그 구간에는 currentUser도 토큰도 없다. 결과가 두 갈래로 나타났다.
//   ① onAuthStateChanged가 null을 흘려 로그인/랜딩 화면이 번쩍 뜬다
//   ② 그 사이 진행된 Firestore 작업이 전부 permission-denied로 실패한다
//      (예약 조회·차량 사용 빈도·예약 패턴·휴일 정보·기관 상태 감시가 한꺼번에 깨졌다)
// ②가 본질이다 — 깜빡임이 아니라 화면이 빈다. 세션이 이미 localStorage에 있으면
// setPersistence가 no-op이라 **간헐적**으로만 재현된다.
//
// `authStateReady()`는 초기 인증 상태가 확정될 때까지 기다린다. main.tsx와 useAuth가 모두
// `authReady`를 await한 뒤에야 움직이므로, 이 한 줄로 **이전 구간이 닫힌 뒤에** 구독과
// Firestore 작업이 시작된다 — 그 구간의 null을 아무도 관측하지 않는다.
//
// ⚠️ persistence를 바꾸지 않은 것은 의도다. `setPersistence`를 제거해 기본 스택(IndexedDB)에
// 맡기면 이전 자체가 사라지지만, 세션 저장 위치가 옮겨져 **기존 사용자가 1회 로그아웃될**
// 위험이 있다. 증상을 없애는 데는 대기만으로 충분하므로 그 위험을 지지 않았다.
export const authReady = isWindowContext
    ? setPersistence(auth, browserLocalPersistence)
        .catch((err) => {
            console.warn('[Auth] persistence 설정 실패:', err);
        })
        .then(() => auth.authStateReady())
    : Promise.resolve();

