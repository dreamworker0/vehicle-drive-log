/**
 * recordSession — 로그인 세션 기록 (onCall)
 *
 * 근거: 고시 「개인정보의 안전성 확보조치 기준」 제16조가 요구하는 접속기록 항목은
 * 계정·일시·**접속지 정보**·처리한 정보주체·수행업무다. Phase 1(변경 로그 트리거)과
 * Phase 2 ①(행위자 스탬프)이 계정·일시·정보주체·수행업무를 채웠지만 **접속지(IP)는
 * 전무했다** — Firestore 트리거는 호출자의 IP를 볼 수 없기 때문이다.
 *
 * ## 왜 콜러블인가 — 그리고 그 한계
 * 콜러블은 `rawRequest`로 IP·User-Agent를 볼 수 있다. 다만 **클라이언트가 부르지
 * 않으면 기록되지 않는다** — 트리거처럼 우회 불가능하지 않다. 이 한계를 감춘 채
 * "접속기록이 완비됐다"고 말하지 않기 위해 여기에 명시해 둔다.
 *
 * 우회 불가능한 대안은 Firebase Auth 블로킹 함수(`beforeUserSignedIn`)다. 인증 서버가
 * 직접 호출하므로 클라이언트가 건너뛸 수 없고 IP·UA도 그대로 받는다. 채택하지 않은 이유:
 *  (1) Identity Platform 업그레이드가 필요해 요금 체계가 바뀐다 — 무료 운영이 전제인
 *      서비스에서 함부로 결정할 수 없다.
 *  (2) 블로킹 함수가 실패하면 **로그인 자체가 막힌다**. 감사 기록의 실패가 전체 가용성을
 *      끊는 구조는 위험 교환이 나쁘다.
 * 전환하려면 요금제 검토와 함께 별건으로 다룬다.
 *
 * ## 기록하지 않는 것
 * User-Agent 원문은 길고 기기 식별에 가까워지므로 브라우저·OS 수준으로 축약해 담는다.
 * 정확한 버전·기기 모델은 접속기록의 목적(비정상 접근 탐지)에 필요하지 않다.
 */
import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { log, wrapHandler } from "../../utils/helpers";
import { checkRateLimitByUid } from "../../utils/rateLimit";
import { resolveClientIp } from "../../utils/clientIp";
import { writeAuditEntry, resolveOrgId } from "../../services/audit/writeAuditEntry";

/** 세션 식별자 형식 — 클라이언트가 생성하는 난수. 문서 ID에 들어가므로 좁게 제한한다. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

interface RecordSessionPayload {
    /**
     * 브라우저 세션당 1개의 난수 식별자.
     * 같은 세션에서 여러 번 불려도 같은 문서를 덮어써 중복이 쌓이지 않게 한다.
     */
    sessionId: string;
}

/**
 * 접속지 IP를 뽑는다.
 *
 * **첫 번째 값을 쓰면 안 된다.** 구글 프런트엔드는 클라이언트가 보낸 `x-forwarded-for`를
 * 지우지 않고 뒤에 덧붙이므로, 맨 앞 값은 신청자가 아니라 **호출자가 적어 넣은 문자열**이다.
 * 그대로 담으면 접속기록의 '접속지 정보'(고시 제16조)가 위조 가능해진다
 * (2026-08-14 감사 부록 4). 신뢰 가능한 자리는 오른쪽에서 두 번째이며,
 * 그 판정은 `resolveClientIp` 한 곳에 모아 뒀다.
 */
function clientIp(req: { headers: Record<string, unknown>; ip?: string } | undefined): string | null {
    if (!req) return null;
    const resolved = resolveClientIp(req);
    return resolved === "unknown" ? null : resolved;
}

/**
 * User-Agent를 브라우저·OS 수준으로 축약한다.
 *
 * 원문을 그대로 저장하면 기기 지문에 가까워져 접속기록 자체가 과잉 수집이 된다.
 * 비정상 접근 탐지에는 "어떤 브라우저·OS에서 들어왔는가"면 충분하다.
 */
function summarizeUserAgent(ua: unknown): string {
    if (typeof ua !== "string" || !ua) return "unknown";

    const os =
        /Android/i.test(ua) ? "Android"
            : /iPhone|iPad|iPod/i.test(ua) ? "iOS"
                : /Windows/i.test(ua) ? "Windows"
                    : /Mac OS X|Macintosh/i.test(ua) ? "macOS"
                        : /Linux/i.test(ua) ? "Linux"
                            : "기타";

    // 순서 주의 — Edge/Samsung/Chrome은 UA에 서로를 포함하므로 좁은 것부터 본다.
    const browser =
        /Edg\//i.test(ua) ? "Edge"
            : /SamsungBrowser/i.test(ua) ? "Samsung Internet"
                : /OPR\//i.test(ua) ? "Opera"
                    : /Whale/i.test(ua) ? "Whale"
                        : /Chrome\//i.test(ua) ? "Chrome"
                            : /Firefox\//i.test(ua) ? "Firefox"
                                : /Safari\//i.test(ua) ? "Safari"
                                    : "기타";

    return `${browser} / ${os}`;
}

export const recordSession = onCall(
    {
        region: "asia-northeast3",
        enforceAppCheck: true,
    },
    wrapHandler("recordSession", async (request: CallableRequest<Partial<RecordSessionPayload>>) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }
        const uid = request.auth.uid;

        const sessionId = request.data?.sessionId;
        if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) {
            throw new HttpsError("invalid-argument", "세션 식별자가 올바르지 않습니다.");
        }

        // 세션당 1회가 정상이나 재시도·탭 복원으로 몇 번 더 올 수 있다.
        // 같은 문서를 덮어쓰므로 쌓이지는 않고, 한도는 남용 방지용이다.
        await checkRateLimitByUid("recordSession", uid, 20, 3600);

        // 기관 식별자는 사용자 문서에서 읽는다 — 기관 관리자의 점검 조회 필터가 된다.
        const organizationId = await resolveOrgId(uid);

        await writeAuditEntry({
            // 문서 ID를 세션 식별자로 고정해 같은 세션의 재호출이 중복을 만들지 않게 한다.
            docId: `session_${uid}_${sessionId}`,
            organizationId,
            action: "login",
            targetType: "session",
            targetId: sessionId,
            // 접속 계정은 곧 행위자다 — 인증 토큰에서 오므로 위조될 수 없다.
            actorUid: uid,
            // 로그인은 자기 계정에 대한 접근이므로 정보주체도 본인이다.
            subjectUids: [uid],
            ip: clientIp(request.rawRequest as never),
            userAgent: summarizeUserAgent(request.rawRequest?.headers?.["user-agent"]),
        });

        log("INFO", "recordSession", "접속 기록", { uid, organizationId });

        return { success: true };
    })
);
