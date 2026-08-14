/**
 * clientIp — 레이트리밋 키로 쓸 수 있는 **조작 불가능한** 클라이언트 IP 추출
 *
 * ## 왜 별도 유틸인가
 *
 * Cloud Functions 2세대 런타임(functions-framework)은 Express에 `trust proxy`를 켜 둔다
 * (`@google-cloud/functions-framework`, `build/src/server.js`의
 * `app.enable('trust proxy'); // To respect X-Forwarded-For header.`).
 * 그래서 `req.ip`는 X-Forwarded-For의 **맨 앞 값**이 된다.
 *
 * 그런데 구글 프런트엔드는 클라이언트가 보낸 XFF를 **지우지 않고 뒤에 덧붙인다**.
 * 즉 맨 앞 값은 공격자가 넣은 문자열 그대로다. `req.ip`나 `headers['x-forwarded-for']`를
 * 그대로 레이트리밋 키로 쓰면 매 요청 난수 IP를 붙이는 것만으로 상한이 무한히 우회된다
 * (2026-08-14 보안 감사 발견 2 — 비인증 Gemini 프리스크린 경로까지 열려 있었다).
 *
 * GCP는 XFF 끝에 `<실제 클라이언트 IP>, <로드밸런서 IP>` 순으로 덧붙인다. 따라서 신뢰할 수
 * 있는 값은 **오른쪽에서 두 번째**다. 공격자가 앞에 몇 개를 끼워 넣든 그 자리는 프런트엔드가
 * 채우므로 밀려나지 않는다.
 *
 * ## 이 값에 기대도 되는 것과 안 되는 것
 *
 * 홉 수(프런트엔드가 덧붙이는 개수)는 경로에 따라 다를 수 있다 — 콜러블은 곧장
 * `*.cloudfunctions.net`으로 가지만, `/api/tmap`·`/api/holiday`는 Firebase Hosting
 * 재작성을 거친다(firebase.json). 그래서 이 함수의 결과는 **최선의 추정**이며,
 * 비용이 걸린 경로의 진짜 방어선은 IP가 아니라 전역 예산(`checkGlobalBudget`)과
 * 인증 주체(uid) 기반 상한이어야 한다. 이 함수는 그 위에 얹는 한 겹이다.
 *
 * 인증이 선행하는 엔드포인트라면 IP 대신 **uid로 키를 잡는 쪽이 항상 낫다** — 위조도
 * 공유 버킷 문제도 없다(`createAuthenticatedProxy` 참고).
 */

/** GCP가 XFF 끝에 덧붙이는 홉 수: `<클라이언트>, <로드밸런서>` */
const TRUSTED_TAIL_HOPS = 2;

/** 레이트리밋 키에 넣기 부적절한 값 */
const UNKNOWN = "unknown";

interface IpSource {
    headers?: Record<string, unknown>;
    ip?: string;
}

/**
 * X-Forwarded-For 헤더를 좌→우 순서의 목록으로 정규화한다.
 * 헤더가 여러 번 실려 배열로 오는 경우까지 하나로 합친다.
 */
function parseForwardedFor(raw: unknown): string[] {
    const joined = Array.isArray(raw) ? raw.join(",") : raw;
    if (typeof joined !== "string") return [];
    return joined
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
}

/**
 * 조작할 수 없는 클라이언트 IP를 돌려준다.
 *
 * - XFF에 2개 이상: 오른쪽에서 두 번째(프런트엔드가 기록한 실제 클라이언트).
 * - XFF가 1개뿐: 프록시가 덧붙이지 않는 환경(에뮬레이터·로컬)으로 보고 그 값을 쓴다.
 *   이 경우는 위조 가능하지만, 그런 환경에는 방어 대상 비용이 없다.
 * - XFF 없음: `req.ip` → 없으면 "unknown".
 */
export function resolveClientIp(req: IpSource | undefined): string {
    const list = parseForwardedFor(req?.headers?.["x-forwarded-for"]);

    if (list.length >= TRUSTED_TAIL_HOPS) {
        return list[list.length - TRUSTED_TAIL_HOPS];
    }
    if (list.length === 1) {
        return list[0];
    }
    return typeof req?.ip === "string" && req.ip ? req.ip : UNKNOWN;
}
