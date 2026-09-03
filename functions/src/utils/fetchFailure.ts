/**
 * fetchFailure — 외부 API에 "닿지 못한" 실패를 한 줄로 요약한다.
 *
 * Node의 fetch(undici)는 `message`에 "fetch failed" 한 줄만 남기고 실제 원인(DNS·연결 끊김·
 * 타임아웃)은 `cause`에 숨긴다. 그대로 로그·Sentry로 보내면 원인 없는 "fetch failed"만 쌓여
 * 받아도 조치할 것이 없다(2026-09-03 holidayProxy 경보).
 *
 * `utils/helpers`가 아니라 별도 파일로 둔 이유: 프록시 단위 테스트는 `utils/helpers`를 통째로
 * 목으로 갈아치우므로(log·wrapHttps만 남긴다) 거기에 두면 실제 구현이 테스트에서 사라진다.
 */

/**
 * AbortSignal.timeout으로 끊긴 실패인지 판별한다.
 * 런타임에 따라 다른 에러의 `cause`에 실려 오기도 해서 두 자리를 모두 본다
 * (apiHealthCheck의 isTimeoutError와 같은 기준).
 */
function isTimeout(e: { name?: string; cause?: { name?: string } } | null): boolean {
    return e?.name === "TimeoutError" || e?.cause?.name === "TimeoutError";
}

/**
 * 로그에 남길 실패 원인 한 줄.
 * @returns `"timeout"` · undici의 `cause.code`(ECONNRESET·ENOTFOUND …) · 그것도 없으면 message
 */
export function describeFetchFailure(err: unknown): string {
    const e = err as { name?: string; message?: string; cause?: { name?: string; code?: string } } | null;
    if (isTimeout(e)) return "timeout";
    return e?.cause?.code || e?.message || "unknown";
}
