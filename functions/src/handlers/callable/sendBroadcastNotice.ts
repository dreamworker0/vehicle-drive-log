/**
 * sendBroadcastNotice — 전체 기관 대상 일괄 공지 (onCall, superAdmin 전용)
 *
 * 기존 `sendAdminNotice`는 **기관 관리자가 자기 기관에만** 보내는 구조라
 * (`userData.organizationId !== orgId`이면 거부) 운영자가 전체 기관에 알릴 경로가
 * 없었다. 약관 개정 시행 같은 서비스 전역 고지는 이 함수가 담당한다.
 *
 * ## 되돌릴 수 없는 대량 행위라는 전제
 * 한 번 보내면 수백~수천 명의 알림함에 남고 푸시가 울린다. 취소가 없다.
 * 그래서 두 가지를 강제한다.
 *  1. `dryRun`으로 **대상 수를 먼저 반환**한다. 화면이 이 값을 보여준 뒤에만 실제 발송을
 *     허용해, 운영자가 "몇 명에게 가는지 모르고" 누르는 상황을 없앤다.
 *  2. `noticeId`로 문서 ID를 고정해 **재클릭·재시도가 알림을 중복 생성하지 않는다**.
 *     같은 사람에게 같은 공지가 두 번 뜨는 것은 오작동으로 읽힌다.
 *
 * ## 왜 sendPushToOrg/createInAppNotificationForOrg를 재사용하지 않는가
 * 두 헬퍼는 기관 단위라 200여 기관을 돌면 ① 기관 수만큼 users 쿼리가 반복되고
 * ② `sendPushToUser`가 uid마다 users 문서를 **다시 읽어** 수천 회의 불필요한 읽기가
 * 생긴다. 여기서는 users를 한 번만 훑고, 그때 얻은 fcmToken으로 `sendEach`(멀티캐스트)를
 * 쓴다. 읽기 N+1이 1로 줄고 푸시도 500건 단위 배치가 된다.
 */
import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { log, wrapHandler, requireSuperAdmin } from "../../utils/helpers";
import { checkRateLimitByUid } from "../../utils/rateLimit";

/** Firestore 배치 쓰기 상한 */
const BATCH_LIMIT = 500;

/** FCM sendEach 1회 상한 */
const PUSH_CHUNK = 500;

/** 공지 식별자 — 문서 ID에 들어가므로 좁게 제한한다 */
const NOTICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

const MAX_TITLE = 100;
const MAX_MESSAGE = 1000;

/** 알림 유형 — 기존 admin_notice와 구분해 전역 공지임을 드러낸다 */
const NOTICE_TYPE = "service_notice";

interface BroadcastPayload {
    title: string;
    message: string;
    /** 같은 공지의 재발송이 중복을 만들지 않도록 화면이 만드는 난수 */
    noticeId: string;
    /** true면 대상 수만 세고 아무것도 보내지 않는다 */
    dryRun?: boolean;
}

interface Recipient {
    uid: string;
    fcmToken?: string;
}

/**
 * 수신 대상을 모은다 — 승인 기관에 소속된 활성 사용자.
 *
 * `status`가 'disabled'인 계정은 로그인할 수 없으므로 알림을 남길 이유가 없다.
 * 기관 미소속(초대 코드 입력 대기·superAdmin)도 제외한다 — 기관 공지의 수신자가 아니다.
 * `status` 필드가 없는 구 문서는 활성으로 본다(비활성은 명시적으로만 기록된다).
 *
 * 서버 필터(`where organizationId != null`)를 쓰지 않는 이유: 부등호 쿼리는 해당 필드의
 * 단일 필드 색인에 의존하는데, 거의 모든 사용자가 기관에 속해 있어 걸러지는 문서가 적다.
 * 색인 정책에 묶이는 대가에 비해 절약되는 읽기가 없어 전량 조회 후 코드에서 거른다.
 */
async function collectRecipients(): Promise<Recipient[]> {
    const snap = await getFirestore().collection("users").get();

    const recipients: Recipient[] = [];
    snap.forEach((doc) => {
        const data = doc.data();
        if (data.status === "disabled") return;
        if (!data.organizationId) return;
        recipients.push({
            uid: doc.id,
            fcmToken: typeof data.fcmToken === "string" && data.fcmToken ? data.fcmToken : undefined,
        });
    });
    return recipients;
}

/** 앱 내 알림을 500건 단위로 나눠 쓴다. 문서 ID 고정으로 재발송이 중복을 만들지 않는다. */
async function writeInAppNotices(
    recipients: Recipient[],
    noticeId: string,
    title: string,
    message: string
): Promise<void> {
    const db = getFirestore();

    for (let i = 0; i < recipients.length; i += BATCH_LIMIT) {
        const batch = db.batch();
        for (const r of recipients.slice(i, i + BATCH_LIMIT)) {
            batch.set(db.collection("notifications").doc(`broadcast_${noticeId}_${r.uid}`), {
                targetUid: r.uid,
                type: NOTICE_TYPE,
                title,
                message,
                read: false,
                createdAt: FieldValue.serverTimestamp(),
            });
        }
        await batch.commit();
    }
}

/**
 * 푸시를 500건 단위로 보낸다. **실패해도 throw하지 않는다** —
 * 앱 내 알림은 이미 남았고, 푸시 실패로 전체를 되돌리면 일부만 받은 상태에서
 * 재발송해야 한다. 성공 수만 세어 돌려준다.
 */
async function sendPushes(
    recipients: Recipient[],
    title: string,
    message: string
): Promise<{ pushSent: number; pushFailed: number }> {
    const tokens = recipients.map((r) => r.fcmToken).filter((t): t is string => !!t);
    if (tokens.length === 0) return { pushSent: 0, pushFailed: 0 };

    const messaging = getMessaging();
    let pushSent = 0;
    let pushFailed = 0;

    for (let i = 0; i < tokens.length; i += PUSH_CHUNK) {
        const chunk = tokens.slice(i, i + PUSH_CHUNK);
        try {
            const res = await messaging.sendEach(
                chunk.map((token) => ({
                    token,
                    notification: { title: `공지: ${title}`, body: message },
                    data: { click_action: "https://vehicle-drive-log.web.app" },
                    android: { priority: "high" as const },
                    webpush: { fcmOptions: { link: "https://vehicle-drive-log.web.app" } },
                }))
            );
            pushSent += res.successCount;
            pushFailed += res.failureCount;
        } catch (err: unknown) {
            // 청크 단위 실패는 그 청크만 실패로 세고 계속 진행한다.
            pushFailed += chunk.length;
            log("ERROR", "sendBroadcastNotice", "푸시 청크 발송 실패", {
                chunkSize: chunk.length, error: (err as Error).message,
            });
        }
    }

    return { pushSent, pushFailed };
}

export const sendBroadcastNotice = onCall(
    {
        region: "asia-northeast3",
        enforceAppCheck: true,
        // 수천 명 팬아웃이라 기본 60초로는 모자랄 수 있다.
        timeoutSeconds: 300,
        memory: "512MiB",
    },
    wrapHandler("sendBroadcastNotice", async (request: CallableRequest<Partial<BroadcastPayload>>) => {
        requireSuperAdmin(request);
        const uid = request.auth.uid;

        const payload = request.data || {};
        const title = typeof payload.title === "string" ? payload.title.trim() : "";
        const message = typeof payload.message === "string" ? payload.message.trim() : "";

        if (!title || title.length > MAX_TITLE) {
            throw new HttpsError("invalid-argument", `제목은 1~${MAX_TITLE}자여야 합니다.`);
        }
        if (!message || message.length > MAX_MESSAGE) {
            throw new HttpsError("invalid-argument", `본문은 1~${MAX_MESSAGE}자여야 합니다.`);
        }
        if (typeof payload.noticeId !== "string" || !NOTICE_ID_PATTERN.test(payload.noticeId)) {
            throw new HttpsError("invalid-argument", "공지 식별자가 올바르지 않습니다.");
        }

        // 전역 팬아웃이라 연타가 곧 과금이다. 미리보기까지 포함해 낮게 잡는다.
        await checkRateLimitByUid("sendBroadcastNotice", uid, 30, 3600);

        const recipients = await collectRecipients();

        if (payload.dryRun) {
            return {
                success: true,
                dryRun: true,
                recipientCount: recipients.length,
                pushableCount: recipients.filter((r) => r.fcmToken).length,
            };
        }

        if (recipients.length === 0) {
            throw new HttpsError("failed-precondition", "발송 대상이 없습니다.");
        }

        // 앱 내 알림이 먼저다 — 푸시는 놓칠 수 있어도 알림함에는 남아야 한다.
        await writeInAppNotices(recipients, payload.noticeId, title, message);
        const { pushSent, pushFailed } = await sendPushes(recipients, title, message);

        log("INFO", "sendBroadcastNotice", "전체 공지 발송", {
            actorUid: uid,
            noticeId: payload.noticeId,
            recipientCount: recipients.length,
            pushSent,
            pushFailed,
        });

        return { success: true, dryRun: false, recipientCount: recipients.length, pushSent, pushFailed };
    })
);
