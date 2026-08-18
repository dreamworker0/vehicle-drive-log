/**
 * Firestore 인스턴스 종료(terminate) 상태 플래그.
 *
 * 로그아웃은 공용 기기에 이전 사용자의 캐시가 남지 않도록 clearOfflineCache()에서
 * Firestore를 terminate()하고 페이지를 떠난다([firebase.ts](./firebase.ts)).
 * 문제는 **떠나기 전까지 페이지가 살아 있다는 것**이다. 종료된 인스턴스에
 * onSnapshot/getDocs를 걸면 SDK가 그 자리에서 동기 throw를 낸다
 * (`FirebaseError: The client has already been terminated.`).
 * 남아 있던 setTimeout 콜백에서 나면 잡아줄 곳이 없어 uncaught로 Sentry에 올라갔다
 * (JAVASCRIPT-REACT-60, /admin/dashboard).
 *
 * 그래서 "지금 구독을 새로 걸어도 되는가"를 앱이 물어볼 수 있게 플래그로 노출한다.
 * SDK 내부 필드(`db._terminated`)에 기대지 않고, terminate() 직전에 우리가 표시한다 —
 * terminate()를 await하는 동안에도 이미 종료 의도가 확정된 구간이므로 함께 막아야 한다.
 *
 * **왜 별도 모듈인가.** firebase.ts에 두면 이 플래그를 읽어야 하는 sentry.ts가
 * Firebase 초기화 모듈을 정적으로 끌어와, 지연 로딩·청크 분리(firebase-db 등)가 무너진다.
 * 의존성이 없는 이 모듈은 어느 쪽에서 import해도 부작용이 없다.
 */
let terminated = false;

/** Firestore terminate()를 호출하기 직전에 표시한다. */
export function markFirestoreTerminated(): void {
    terminated = true;
}

/** 종료된(또는 종료 중인) 인스턴스인지 — true면 새 쿼리·구독을 걸어서는 안 된다. */
export function isFirestoreTerminated(): boolean {
    return terminated;
}
