/**
 * ocrDocument — 비영리 증빙 서류 OCR (Gemini API)
 *
 * 시스템 관리자 신청 관리의 [AI 재분석]이 부른다. 판별은 접수 프리스크린·자동 검증 트리거와
 * **같은 프롬프트·같은 판정**(services/driveLog/documentScreen)을 쓴다.
 *
 * 2026-10-16 — 예전에는 이 함수만 별도 프롬프트로 `{orgName, bizNumber, isNonProfit, …}`를 돌려줬는데
 * 화면은 `{documentType, uniqueNumber, extractedName, nameMatch, address, aiVerified}`를 기대해
 * 그 값(undefined)을 기관 문서에 쓰다 Firestore가 거부했다 — [AI 재분석]은 Gemini 비용만 쓰고
 * 늘 "분석에 실패했습니다"로 끝났다. 별도 사업자번호 판정(80~89를 모두 비영리로 본다 — 81·85·86
 * 영리법인 포함)도 트리거 쪽과 갈라져 있었다.
 */
import { GEMINI_API_KEY } from "../../core/params";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getStorage } from "firebase-admin/storage";
import { generateAiContent } from "../../core/gemini";
import { wrapCallableHandler, sanitizePromptValue } from "../../utils/helpers";
import { MAX_BASE64_SIZE, getRateLimits } from "../../utils/constants";
import { checkDailyOcrQuota } from "../../utils/rateLimit";
import { buildOcrPrompt, parseScreenResponse, isNonProfitDocument, type ScreenResult } from "../../services/driveLog/documentScreen";

/** 화면(OrgApplicationList [AI 재분석])이 기관 문서의 aiVerifyDetail로 저장하는 모양 */
interface OcrResult extends ScreenResult {
    /** 비영리 증빙 + 고유번호를 읽었을 때만 true — autoVerifyDocument의 자동 승인 조건과 같다 */
    aiVerified: boolean;
    raw: string;
}

/**
 * Storage 파일을 base64로 다운로드
 */
async function downloadFileAsBase64(filePath: string): Promise<{ base64: string; mimeType: string }> {
    const bucket = getStorage().bucket();
    const file = bucket.file(filePath);

    const [buffer] = await file.download();
    const base64 = buffer.toString("base64");

    // 확장자에서 MIME 타입 추출
    const ext = filePath.split(".").pop()?.toLowerCase() || "jpeg";
    const mimeMap: Record<string, string> = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        gif: "image/gif",
        webp: "image/webp",
        pdf: "application/pdf",
    };
    const mimeType = mimeMap[ext] || "image/jpeg";

    return { base64, mimeType };
}

export const ocrDocument = onCall(
    {
        region: "asia-northeast3",
        secrets: [GEMINI_API_KEY],
        timeoutSeconds: 120,
        memory: "512MiB",
        enforceAppCheck: true,
    },
    wrapCallableHandler("ocrDocument", { rateLimitKey: "ocrDocument", rateLimitFailMode: "closed" }, async (request) => {
        const { storagePath, imageBase64, mimeType, orgName } = request.data as { storagePath?: string; imageBase64?: string; mimeType?: string; orgName?: string };

        if (!storagePath && !imageBase64) {
            throw new HttpsError("invalid-argument", "storagePath 또는 imageBase64가 필요합니다.");
        }

        // storagePath 경로 조작 방지: 호출자의 기관 또는 본인 폴더만 접근 허용
        if (storagePath) {
            // 상대경로·역슬래시·선행 슬래시가 섞인 경로는 prefix 검사 우회 시도로 간주하고 거부
            if (storagePath.includes("..") || storagePath.includes("\\") || storagePath.startsWith("/")) {
                throw new HttpsError("invalid-argument", "유효하지 않은 파일 경로입니다.");
            }
            const callerOrgId = request.auth!.token.orgId;
            const callerUid = request.auth!.uid;
            const isSuperAdmin = request.auth!.token.role === "superAdmin";
            const isOrgPath = callerOrgId && storagePath.startsWith(`organizations/${callerOrgId}/`);
            const isFeedbackPath = storagePath.startsWith(`feedbacks/${callerUid}/`) || storagePath.startsWith(`feedbacks/ocr-report/${callerUid}/`);
            // superAdmin은 기관 심사를 위해 임의 기관 증빙서류를 재검증할 수 있다. (2026-07-18 보안 재검증 P0-3)
            const isSuperAdminOrgPath = isSuperAdmin && storagePath.startsWith("organizations/");
            if (!isOrgPath && !isFeedbackPath && !isSuperAdminOrgPath) {
                throw new HttpsError("permission-denied", "접근 권한이 없는 파일입니다.");
            }
        }

        // imageBase64 크기 제한 (~5MB 원본 = ~6.67MB base64)
        if (imageBase64 && imageBase64.length > MAX_BASE64_SIZE) {
            throw new HttpsError("invalid-argument", "이미지 크기가 너무 큽니다 (최대 5MB).");
        }

        // 일일 누적 한도(사용자/조직) — 분 단위 제한과 별개의 비용 증폭 방어 (ocr-cost-security §1.1).
        // 입력·경로 검증 **뒤에** 센다 — 앞에 두면 Gemini를 부르지 않는 잘못된 요청(경로 조작·
        // 남의 기관 파일 포함)도 하루 한도를 깎았다(2026-10-16, ocrDashboard와 같은 순서).
        const [dailyUser, dailyOrg] = await Promise.all([getRateLimits("ocrDailyUser"), getRateLimits("ocrDailyOrg")]);
        await checkDailyOcrQuota(request.auth!.uid, request.auth!.token.orgId as string | undefined, dailyUser, dailyOrg);

        let base64Data: string;
        let fileMimeType: string;

        if (imageBase64) {
            base64Data = imageBase64;
            fileMimeType = mimeType || "image/jpeg";
        } else {
            const downloaded = await downloadFileAsBase64(storagePath!);
            base64Data = downloaded.base64;
            fileMimeType = downloaded.mimeType;
        }



        // 신청 기관명은 이름 일치 판단에만 쓰이고 프롬프트에 보간되므로 위생 처리한다(트리거와 같다)
        const text = await generateAiContent(
            buildOcrPrompt(sanitizePromptValue(orgName, 60)),
            {
                mimeType: fileMimeType,
                data: base64Data,
            }
        );

        const screen = parseScreenResponse(text);
        const result: OcrResult = {
            ...screen,
            aiVerified: isNonProfitDocument(screen.documentType) && screen.uniqueNumber != null,
            raw: text,
        };

        console.log(`OCR 완료: ${result.documentType} (자동 승인 조건: ${result.aiVerified})`);

        return result;
    })
);

