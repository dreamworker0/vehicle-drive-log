/**
 * firebaseAuth.ts — Auth 전용 경량 모듈
 *
 * main.tsx와 lightEntry.tsx에서 사용하는 최소한의 Firebase Auth 초기화.
 * firebase.ts와 달리 Firestore, Storage, Analytics, AppCheck를 로드하지 않음.
 *
 * ⚠️ 이 모듈은 경량 경로(비인증 사용자)에서만 사용해야 함.
 * 인증 후 전체 앱에서는 반드시 firebase.ts의 auth를 사용할 것.
 *
 * ⚠️ `authReady`를 await한 뒤에 onAuthStateChanged를 구독해야 한다.
 * 그러지 않으면 첫 콜백 시점에 저장소 세션 복원이 끝나지 않아 user=null로 판단하고
 * 새 탭에서 로그아웃되는 버그가 난다 (그것이 이 export의 존재 이유다).
 */
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, initializeAuth, indexedDBLocalPersistence, connectAuthEmulator } from 'firebase/auth';

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

/**
 * 초기 인증 상태가 확정될 때까지 기다린다. 구독·Firestore 작업은 전부 이 뒤에서 시작한다.
 *
 * ## setPersistence(browserLocalPersistence)를 부르지 않는 이유 — 세션을 가장 약한 곳에 두게 된다
 *
 * `getAuth()`는 기본 우선순위 `[IndexedDB, localStorage, sessionStorage]`로 초기화된다.
 * 예전에는 그 뒤에 `setPersistence(browserLocalPersistence)`를 불러 **저장 위치를 localStorage로
 * 고정**했다. 그런데 그 호출은 설정 변경이 아니라 **이전**이다 — 세션이 IndexedDB에 있으면
 * 읽어서 **지우고** localStorage에 다시 쓴다. 프로덕션 스택 트레이스로 확인했다:
 *   setPersistence → removeCurrentUser → _remove → _withPendingWrite → IndexedDB
 *
 * 그래서 두 가지가 겹쳤다.
 *   ① 부팅마다 세션이 어느 쪽에도 없는 구간이 생긴다(로그인 화면 플래시·permission-denied 폭풍)
 *   ② 사본이 localStorage 한 곳에만 남는다 — 그리고 **모바일에서 그게 가장 먼저 날아간다**
 *
 * ②가 휴대폰 PWA의 "잠깐 뒀다 다시 열었더니 로그아웃"의 경로다. Firebase의 localStorage
 * 구현은 모바일이면 storage 이벤트 대신 **1초 폴링**으로 바뀌고(`fallbackToPolling =
 * _isMobileBrowser()`), 그 읽기가 한 번이라도 비면 재시도나 다른 저장소 조회 없이
 * `_updateCurrentUser(null)` — 즉 로그아웃으로 직행한다. 기본값(IndexedDB)은 그 경로를 타지 않고,
 * 설령 IndexedDB를 못 쓰는 환경이어도 우선순위 목록이 localStorage로 알아서 내려간다.
 *
 * **기존 사용자는 로그아웃되지 않는다.** `PersistenceUserManager.create`는 우선순위 목록
 * **전체**를 뒤져 세션을 찾고, 찾으면 1순위(IndexedDB)에 옮겨 쓴 뒤 나머지를 지운다
 * (@firebase/auth). localStorage에 있던 세션은 첫 부팅에서 그대로 이관된다.
 *
 * 원래 `setPersistence`가 막으려던 "새 탭 로그아웃"은 아래 `authStateReady()`를 await하는 것이
 * 막는다 — 그쪽이 진짜 처방이었다.
 */
export const authReady = isWindowContext ? auth.authStateReady() : Promise.resolve();
