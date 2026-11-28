/**
 * vehicleStatusApi — 기관 외부 연동용 읽기 전용 API (GET /api/v1/vehicles)
 *
 * 기관이 자체 도구(구글 앱스 스크립트 등)에서 차량별 누적 주행거리와 하이패스 잔액을
 * 읽어 가는 통로다. 키 발급·폐기는 관리자 설정 화면의 `manageExternalApiKey` 콜러블이 한다.
 *
 * 인증: `Authorization: Bearer <키>` (또는 `X-API-Key: <키>`). 키 해시로 기관을 찾는다.
 * 통과 조건: 키가 살아 있고 + 기관이 승인 상태이고 + 기관이 [외부 연동(API)]을 켰을 것.
 * 토글을 끄면 키를 지우지 않아도 바로 막힌다(다시 켜면 같은 키가 다시 통한다).
 *
 * ## 일부러 하지 않는 것
 * - **CORS를 열지 않는다.** 서버(앱스 스크립트)에서 부르는 용도다. 브라우저에서 부르려면
 *   키를 웹 페이지에 심어야 하는데, 그러면 키가 누구에게나 보인다.
 * - **쓰기는 없다.** GET 하나만 받는다.
 * - 응답은 캐시하지 않는다(Hosting 재작성을 거치므로 CDN이 담지 않게 `no-store`).
 */
import { onRequest, type Request } from "firebase-functions/v2/https";
import type { Response } from "express";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { log, wrapHttps } from "../../utils/helpers";
import { checkRateLimitByIp, checkRateLimitBySubject } from "../../utils/rateLimit";
import { resolveClientIp } from "../../utils/clientIp";
import { getRateLimits } from "../../utils/constants";
import { API_KEYS_COLLECTION, extractApiKey, hashApiKey, isWellFormedApiKey } from "../../services/externalApi/apiKeys";
import { buildVehicleStatus } from "../../services/externalApi/vehicleStatus";

/**
 * 인증 전 IP 상한 — 틀린 키를 마구 넣어 보는 요청을 묶는다. 키가 32바이트 난수라 맞힐 수는
 * 없지만, 요청마다 문서 1건을 읽으므로 비용 상한이 필요하다. 정상 사용(시간당 몇 번)의 수십 배.
 */
const IP_LIMIT = { max: 120, windowSec: 3600 };

/** 마지막 사용 시각은 이 간격보다 오래됐을 때만 갱신한다(매 호출 쓰기를 피한다) */
const LAST_USED_REFRESH_MS = 60 * 60 * 1000;

function deny(res: Response, status: number, error: string): void {
    res.status(status).json({ error });
}

export const vehicleStatusApi = onRequest(
    {
        region: "asia-northeast3",
        cors: false,
        memory: "256MiB",
        timeoutSeconds: 30,
        // 앱스 스크립트가 몇 분~몇 시간에 한 번 부르는 정도다. 동시 처리량이 필요 없다.
        maxInstances: 3,
    },
    wrapHttps("vehicleStatusApi", async (req: Request, res: Response) => {
        res.set("Cache-Control", "private, no-store");

        if (req.method !== "GET") {
            res.set("Allow", "GET");
            deny(res, 405, "GET 요청만 받습니다.");
            return;
        }

        const clientIp = resolveClientIp(req);
        if (await checkRateLimitByIp("vehicleStatusApiIp", clientIp, IP_LIMIT.max, IP_LIMIT.windowSec)) {
            deny(res, 429, "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
            return;
        }

        const key = extractApiKey(req.headers as Record<string, unknown>);
        if (!isWellFormedApiKey(key)) {
            deny(res, 401, "API 키가 없거나 형식이 올바르지 않습니다. Authorization: Bearer <키> 헤더로 보내 주세요.");
            return;
        }

        const db = getFirestore();
        const keyRef = db.collection(API_KEYS_COLLECTION).doc(hashApiKey(key));
        const keySnap = await keyRef.get();
        const organizationId = keySnap.data()?.organizationId;
        if (!keySnap.exists || typeof organizationId !== "string" || organizationId === "") {
            deny(res, 401, "유효하지 않은 API 키입니다. 폐기되었거나 새로 발급된 키인지 확인해 주세요.");
            return;
        }

        const orgSnap = await db.collection("organizations").doc(organizationId).get();
        const org = orgSnap.data();
        if (!orgSnap.exists || org?.status !== "approved") {
            deny(res, 403, "이용할 수 없는 기관입니다.");
            return;
        }
        if (org.externalApiEnabled !== true) {
            deny(res, 403, "기관 설정에서 [외부 연동(API)]이 꺼져 있습니다. 관리자에게 켜 달라고 요청해 주세요.");
            return;
        }

        const limit = await getRateLimits("vehicleStatusApi");
        if (await checkRateLimitBySubject("vehicleStatusApi", `org_${organizationId}`, limit.max, limit.windowSec)) {
            deny(res, 429, "요청이 너무 많습니다. 호출 간격을 늘려 주세요.");
            return;
        }

        const body = await buildVehicleStatus(
            db,
            organizationId,
            typeof org.name === "string" ? org.name : "",
            org.hipassEnabled !== false,
        );

        // 마지막 사용 시각 — 관리자 화면에서 "이 키가 실제로 쓰이고 있는가"를 보여 준다.
        // 응답을 늦추지 않도록 실패해도 무시한다(키 사용 자체와는 무관한 부가 정보다).
        const lastUsed = keySnap.data()?.lastUsedAt;
        const lastUsedMs = lastUsed instanceof Timestamp ? lastUsed.toMillis() : 0;
        if (Date.now() - lastUsedMs > LAST_USED_REFRESH_MS) {
            try {
                await keyRef.update({ lastUsedAt: FieldValue.serverTimestamp() });
            } catch (err) {
                log("WARNING", "vehicleStatusApi", "마지막 사용 시각 갱신 실패", { organizationId, error: (err as Error).message });
            }
        }

        res.status(200).json(body);
    }),
);
