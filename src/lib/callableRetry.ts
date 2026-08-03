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
 *
 * ## 재시도해도 되는 콜러블인가
 * 첫 시도가 시간 초과로 보여도 **서버는 이미 처리했을 수 있다.** 그래서 이 헬퍼는
 * 결정론적 문서 ID로 멱등하게 쓰는 콜러블에만 쓴다(같은 sessionId·exportId면 같은 문서를
 * 덮어쓰고, 동의 기록은 merge 쓰기라 반복해도 결과가 같다).
 * 부를 때마다 새 문서를 만드는 콜러블에는 쓰지 않는다 — 중복이 쌓인다.
 */
import { httpsCallable } from 'firebase/functions';
import { firebaseFunctions } from './firebase';

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
}
