import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { log, wrapHandler } from "../../utils/helpers";
import { checkRateLimitByUid, checkRateLimitByIp } from "../../utils/rateLimit";
import { maskEmail } from "../../utils/mask";

/**
 * 업로드 허용 MIME 화이트리스트 (2026-07-10 코덱스 평가 대응 — 작업 3).
 * 캘러 제공 MIME을 그대로 contentType으로 저장하면 text/html 등이 Storage에
 * 실행 가능한 형태로 서빙될 수 있으므로 증빙서류 형식만 허용한다.
 * 매직 바이트 검증은 5MB 상한·rate limit·Storage Rules가 병존해 미채택.
 */
const ALLOWED_MIME_TYPES: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
};

interface SubmitApplicationPayload {
    orgName: string;
    applicantName: string;
    applicantEmail: string;
    applicantPhone: string;
    message: string;
    imageBase64: string; // Base64 인코딩된 이미지 문자열 (data:image/jpeg;base64, 부분 제외)
    imageMimeType: string; // 예: "image/jpeg", "application/pdf"
    agreedTerms: boolean; // 이용약관 동의 (제9조 개인정보 처리의 위탁 포함)
    agreedPrivacy: boolean; // 개인정보 처리방침 동의
    termsVersion: string; // 동의한 약관의 시행일 버전 (src/lib/constants.ts TERMS_VERSION)
    privacyVersion: string; // 동의한 처리방침의 시행일 버전 (PRIVACY_VERSION)
}

/**
 * 동의한 문서 버전은 시행일(YYYY-MM-DD)만 허용한다.
 *
 * 현재 시행 중인 버전값과의 일치까지 강제하지는 않는다. 이 서비스는 PWA로
 * 서비스워커가 이전 번들을 캐시하고 있을 수 있어, 캐시된 화면에서 신청하면
 * 직전 버전을 보내온다. 이때 서버가 거부하면 정상 신청자가 가입 자체를 못 하게 되고,
 * 이는 임의 날짜가 기록되는 것보다 큰 손실이다.
 * 신청 문서의 다른 필드(기관명·연락처)도 모두 신청자가 제출한 값이고 superAdmin 심사를
 * 거치므로, 버전값의 신뢰 수준을 나머지 필드보다 높게 잡을 실익도 없다.
 */
const VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * submitOrgApplication
 * 기관 가입 신청서 및 비영리 증빙서류 업로드 (익명 로그인 대체용)
 * 미가입 사용자가 호출하므로 request.auth 검사를 생략하지만,
 * applicantEmail 기반으로 Rate Limit을 적용하여 스팸을 방지한다.
 */
export const submitOrgApplication = onCall(
    {
        region: "asia-northeast3",
        memory: "512MiB",
        timeoutSeconds: 60,
        // **의도적으로 끈다.** 2026-07-18 보안 재점검이 App Check 적용을 권고했지만,
        // 이 앱은 인앱 브라우저(카톡·네이버)에서 App Check를 **초기화하지 않는다**
        // (src/lib/firebase.ts의 `!isInAppBrowser()` — Phase 61 reCAPTCHA 중복 렌더 충돌 회피).
        // 그런데 /apply는 InAppBrowserGuard 바깥이라 인앱에서도 열린다(구글 로그인이
        // 필요 없는 미가입자 경로이므로 의도된 설계다).
        // 여기서 강제하면 카톡으로 링크를 받아 신청하는 기관이 전부 막힌다 — 국내
        // 사회복지기관 대상 서비스에서 이는 신청 유입 자체를 끊는 비용이다.
        // 대신 아래 이메일·IP Rate Limit과 superAdmin 심사가 방어선이다.
        // 재검토 조건: 인앱에서도 App Check를 안전하게 초기화할 수 있게 되면 켠다.
        enforceAppCheck: false,
    },
    wrapHandler("submitOrgApplication", async (request: CallableRequest<Partial<SubmitApplicationPayload>>) => {
        const payload = request.data;

        // 1. 필수 값 검증
        if (!payload.orgName || !payload.applicantName || !payload.applicantEmail || !payload.applicantPhone) {
            throw new HttpsError("invalid-argument", "필수 입력 항목이 누락되었습니다.");
        }
        if (!payload.imageBase64 || !payload.imageMimeType) {
            throw new HttpsError("invalid-argument", "증빙서류 이미지 데이터가 누락되었습니다.");
        }
        if (!(payload.imageMimeType in ALLOWED_MIME_TYPES)) {
            throw new HttpsError("invalid-argument", "지원하지 않는 파일 형식입니다. JPG·PNG·WebP 이미지 또는 PDF만 업로드할 수 있습니다.");
        }
        // 입력 길이 상한 (과도한 문서/알림 페이로드 방지)
        if (payload.orgName.length > 100 || payload.applicantName.length > 100
            || payload.applicantPhone.length > 30 || (payload.message?.length ?? 0) > 2000) {
            throw new HttpsError("invalid-argument", "입력 값의 길이가 허용 범위를 초과했습니다.");
        }

        // 1-1. 약관·처리방침 동의 검증
        // 동의는 위탁 계약(약관 제9조) 성립의 요건이므로 서버에서 확정한다.
        // 프론트의 버튼 disabled만으로는 콜러블 직접 호출을 막을 수 없어, 여기서 막지 않으면
        // 동의 기록이 없는 기관 문서가 생성된다.
        if (payload.agreedTerms !== true || payload.agreedPrivacy !== true) {
            throw new HttpsError("invalid-argument", "이용약관과 개인정보 처리방침에 동의해야 신청할 수 있습니다.");
        }
        if (typeof payload.termsVersion !== "string" || typeof payload.privacyVersion !== "string"
            || !VERSION_PATTERN.test(payload.termsVersion) || !VERSION_PATTERN.test(payload.privacyVersion)) {
            throw new HttpsError("invalid-argument", "동의한 약관 버전 정보가 올바르지 않습니다.");
        }

        const email = payload.applicantEmail.trim().toLowerCase();

        // 2. Rate Limit 검사: 동일 이메일로 1시간에 3회 이상 신청 불가 (무단 반복 요청 방지)
        // checkRateLimitByUid는 원래 uid 기반이지만, 이메일을 uid처럼 활용하여 제한
        await checkRateLimitByUid("submitOrgApplication", email, 3, 3600, "closed");

        // 2-1. IP 기반 상한 — 이메일을 회전시켜 이메일 키 제한을 우회하는 무제한 익명 쓰기 차단 (2026-07-04 감사 N4)
        const clientIp = request.rawRequest?.ip
            || (request.rawRequest?.headers["x-forwarded-for"] as string)
            || "unknown";
        if (await checkRateLimitByIp("submitOrgApplication", clientIp, 10, 3600, "closed")) {
            throw new HttpsError("resource-exhausted", "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.");
        }

        try {
            const db = getFirestore();
            const storage = getStorage();
            const bucket = storage.bucket(); // 기본 버킷

            // 3. 새 기관 문서 ID 생성 (사전 발급)
            const orgRef = db.collection("organizations").doc();
            const orgId = orgRef.id;

            // 4. Base64 이미지 디코딩 및 Storage 업로드
            let fileBuffer: Buffer;
            try {
                // data: URI prefix가 섞여 왔을 경우를 대비한 안전 제거 정규식
                const base64Data = payload.imageBase64.replace(/^data:([A-Za-z-+/]+);base64,/, '');
                fileBuffer = Buffer.from(base64Data, "base64");
            } catch (bufferErr) {
                log("ERROR", "submitOrgApplication", "이미지 디코딩 실패", { email: maskEmail(email), error: (bufferErr as Error).message });
                throw new HttpsError("invalid-argument", "잘못된 이미지 형식입니다.");
            }

            // 파일 용량 초과 검증 (5MB 제한)
            if (fileBuffer.byteLength > 5 * 1024 * 1024) {
                throw new HttpsError("out-of-range", "파일 크기는 5MB를 초과할 수 없습니다.");
            }

            const ext = ALLOWED_MIME_TYPES[payload.imageMimeType];
            const filePath = `organizations/${orgId}/uniqueNumberImage.${ext}`;
            const file = bucket.file(filePath);

            log("INFO", "submitOrgApplication", "Uploading image", { email: maskEmail(email), orgId, size: fileBuffer.byteLength });

            // 증빙서류는 민감정보이므로 영구 다운로드 토큰(firebaseStorageDownloadTokens)을 심지 않는다.
            // 접근은 Storage 보안 규칙(superAdmin/기관 멤버 read)과 심사 시 발급하는 단기 서명 URL
            // (getOrgDocumentUrl 콜러블)로만 통제한다. (2026-07-18 보안 재검증 P0-3)
            await file.save(fileBuffer, {
                metadata: {
                    contentType: payload.imageMimeType,
                },
            });

            // 5. Firestore 문서 생성 — 토큰 URL이 아닌 Storage 경로만 저장한다.
            const now = FieldValue.serverTimestamp();
            await orgRef.set({
                name: payload.orgName.trim(),
                applicantName: payload.applicantName.trim(),
                applicantEmail: email,
                applicantPhone: payload.applicantPhone.trim(),
                applicantUid: "anonymous-app", // 익명 로그인 대체 플래그
                message: payload.message ? payload.message.trim() : "",
                status: "pending",
                aiVerified: false,
                uniqueNumberImagePath: filePath,
                // 위탁 계약 성립 근거 — 어느 버전에 언제 동의했는지를 기관 문서와 함께 보관한다.
                // 동의 일시는 서버 시각으로 기록하며, 동의 시점 IP는 수집하지 않는다
                // (신청자 이메일·전화번호로 동의 주체가 특정되므로 최소수집 원칙을 따른다).
                consent: {
                    terms: true,
                    privacy: true,
                    termsVersion: payload.termsVersion,
                    privacyVersion: payload.privacyVersion,
                    agreedAt: now,
                },
                createdAt: now,
                updatedAt: now,
            });

            log("INFO", "submitOrgApplication", "신청 완료", { orgId, email: maskEmail(email) });

            return {
                success: true,
                orgId,
            };
        } catch (err: unknown) {
            log("ERROR", "submitOrgApplication", "업로드 또는 저장 처리 중 시스템 오류", {
                email: maskEmail(email),
                error: (err as Error).message,
                stack: (err as Error).stack,
            });
            throw new HttpsError("internal", "신청을 처리하는 중에 시스템 오류가 발생했습니다.");
        }
    })
);
