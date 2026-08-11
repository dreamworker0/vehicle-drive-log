/**
 * callableRetry — 콜러블 호출의 대기 시간·재시도 공통 규약
 *
 * ## 왜 필요한가 — `FirebaseError: deadline-exceeded`의 정체
 * firebase/functions SDK는 콜러블 응답을 **기본 70초**까지 기다리고, 그 안에 오지 않으면
 * `FirebaseError('deadline-exceeded', 'deadline-exceeded')`를 던진다(코드와 메시지가 같은
 * 문자열이라 Sentry에는 `FirebaseError: deadline-exceeded` 한 줄로만 남는다).
 * 요청을 중단시키지도 않는다 — 타이머가 먼저 끝났을 뿐 서버는 계속 처리한다.
 *
 * 즉 이 에러는 "서버가 거부했다"가 아니라 **"응답이 70초 안에 돌아오지 않았다"**는 뜻이다.
 * 모바일 네트워크가 끊기거나 탭이 백그라운드로 내려가 요청이 멈추면, 또는 호출이 드문
 * 함수라 콜드 스타트가 겹치면 여기에 걸린다. 우리 콜러블은 대부분 문서 한두 건을 쓰는
 * 짧은 작업이라 70초를 기다릴 이유가 없다 — 그 시간이면 이미 실패한 요청이다.
 *
 * ## 규약
 *  (1) 대기 시간을 짧게 잡고(기본 20초), (2) 짧은 백오프로 다시 부른다.
 *  (3) 재시도해도 안 되면 마지막 에러를 그대로 던진다 — 보고 여부는 호출부가 정한다.
 *  (4) **토큰 만료(`unauthenticated`)는 별도 경로다** — 백오프가 아니라 토큰 갱신이 처방이라
 *      갱신 후 한 번만 다시 돌린다(isAuthExpiredError 주석 참고).
 *
 * ## 재시도해도 되는 콜러블인가
 * 첫 시도가 시간 초과로 보여도 **서버는 이미 처리했을 수 있다.** 그래서 이 헬퍼는
 * 결정론적 문서 ID로 멱등하게 쓰는 콜러블에만 쓴다(같은 sessionId·exportId면 같은 문서를
 * 덮어쓰고, 동의 기록은 merge 쓰기라 반복해도 결과가 같다).
 * 부를 때마다 새 문서를 만드는 콜러블에는 쓰지 않는다 — 중복이 쌓인다.
 */
import { httpsCallable } from 'firebase/functions';
import { auth, firebaseFunctions } from './firebase';
import { refreshTokenSilently } from './tokenRefresh';

/** 시도 1회당 대기 시간. SDK 기본값(70초)은 짧은 쓰기 작업에 비해 지나치게 길다. */
export const DEFAULT_CALL_TIMEOUT_MS = 20_000;

export interface CallWithRetryOptions {
    /** 시도 1회당 대기 시간 (ms) */
    timeoutMs?: number;
    /** 최대 시도 횟수 (첫 시도 포함) */
    attempts?: number;
    /** 재시도 간격의 기준값 (ms). 시도마다 2배로 늘어난다. */
    baseDelayMs?: number;
}

/**
 * 다시 불러 볼 만한 실패인지 판별한다.
 *
 * 여기 없는 코드(invalid-argument·permission-denied·resource-exhausted 등)는
 * **다시 불러도 같은 답이 온다.** 재시도는 시간만 쓰고 한도만 깎는다.
 */
const TRANSIENT_CODES = new Set(['deadline-exceeded', 'unavailable', 'internal', 'aborted']);

export function isTransientCallableError(err: unknown): boolean {
    if (!err) return false;
    const e = err as { code?: unknown; message?: unknown };

    // FunctionsError의 code는 `functions/deadline-exceeded` 형태로 서비스 접두사가 붙는다.
    // Firestore 에러는 접두사 없이 온다 — 둘 다 받도록 뒤쪽만 본다.
    if (typeof e.code === 'string') {
        const bare = e.code.includes('/') ? e.code.slice(e.code.lastIndexOf('/') + 1) : e.code;
        if (TRANSIENT_CODES.has(bare)) return true;
    }

    const msg = typeof e.message === 'string' ? e.message.toLowerCase() : '';
    if (!msg) return false;
    return TRANSIENT_CODES.has(msg)
        || msg.includes('network')
        || msg.includes('failed to fetch')
        || msg.includes('deadline-exceeded');
}

/**
 * 토큰이 만료돼 서버가 거부한 경우인지 판별한다.
 *
 * **`unauthenticated`는 위 TRANSIENT_CODES에 넣으면 안 되고, 거부로 취급해서도 안 된다.**
 * 그냥 다시 부르면 같은 만료 토큰을 다시 보내니 같은 답이 온다 — 그래서 일시적 실패가 아니다.
 * 하지만 **토큰을 갱신하고 부르면 통과한다** — 그래서 영구 거부도 아니다. 처방이 다르므로
 * 판별과 재시도 경로를 분리한다(.agent/rules/token-auth-resilience.md §2).
 *
 * 실제로 이 갭이 Sentry에 드러났다: Samsung Internet(Android)에서 탭이 백그라운드에 있다가
 * 돌아오면 캐시된 ID 토큰이 만료돼 콜러블이 `FirebaseError: Unauthenticated`로 떨어지고,
 * 호출부는 그것을 앱 버그로 보고했다. 규칙 서문이 지목한 바로 그 환경이다.
 *
 * 메시지 형태도 함께 본다 — Functions 인프라가 우리 핸들러 앞에서 거부하면 커스텀 메시지
 * 없이 `Unauthenticated` 한 단어만 온다(우리 HttpsError는 한국어 메시지를 실어 보낸다).
 */
export function isAuthExpiredError(err: unknown): boolean {
    if (!err) return false;
    const e = err as { code?: unknown; message?: unknown };

    if (typeof e.code === 'string') {
        const bare = e.code.includes('/') ? e.code.slice(e.code.lastIndexOf('/') + 1) : e.code;
        if (bare === 'unauthenticated') return true;
    }
    return typeof e.message === 'string' && e.message.trim().toLowerCase() === 'unauthenticated';
}

const delay = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

/**
 * 콜러블을 짧은 대기 시간으로 부르고, 일시적 실패면 백오프 후 다시 부른다.
 *
 * @param name    콜러블 이름 (functions/src/index.ts에서 export한 이름)
 * @param payload 요청 본문
 * @returns 콜러블의 `data`
 * @throws 마지막 시도의 에러 (호출부가 보고 여부를 판단한다)
 */
export async function callWithRetry<TReq = unknown, TRes = unknown>(
    name: string,
    payload: TReq,
    { timeoutMs = DEFAULT_CALL_TIMEOUT_MS, attempts = 3, baseDelayMs = 2000 }: CallWithRetryOptions = {},
): Promise<TRes> {
    // httpsCallable 자체가 던지는 경우(functions 미초기화 등)도 async 함수 안이라
    // 예외가 아니라 reject로 나간다 — 호출부의 .catch()가 일관되게 받는다.
    const call = httpsCallable<TReq, TRes>(firebaseFunctions, name, { timeout: timeoutMs });

    const runAttempts = async (): Promise<TRes> => {
        let lastError: unknown;
        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                const result = await call(payload);
                return result.data;
            } catch (err) {
                lastError = err;
                if (attempt >= attempts || !isTransientCallableError(err)) break;
                console.debug(`[callWithRetry:${name}] ${attempt}번째 시도 실패 — 재시도`, err);
                await delay(baseDelayMs * 2 ** (attempt - 1));
            }
        }
        throw lastError;
    };

    try {
        return await runAttempts();
    } catch (err) {
        // 토큰 만료면 갱신하고 **딱 한 번** 더 돌린다. 루프 안에서 처리하지 않는 이유는
        // 시도 횟수를 갉아먹지 않게 하려는 것이고, 한 번으로 제한하는 이유는 진짜
        // 로그아웃 상태에서 갱신·재시도를 무한히 반복하지 않게 하려는 것이다
        // (규칙 §5: 무한 루프에 빠지게 두지 않는다).
        if (!isAuthExpiredError(err) || !auth.currentUser) throw err;

        console.debug(`[callWithRetry:${name}] 토큰 만료로 거부됨 — 갱신 후 재시도`);
        // refreshTokenSilently는 실패를 삼킨다. 갱신이 안 됐다면 아래 재시도가 같은
        // unauthenticated로 떨어지고, 그건 진짜 로그아웃 상태라는 뜻이라 호출부로 넘긴다.
        await refreshTokenSilently(auth.currentUser);
        // 백오프를 두지 않는다 — 기다려서 나아지는 문제가 아니라 토큰이 바뀌어야 하는 문제다.
        return await runAttempts();
    }
}
