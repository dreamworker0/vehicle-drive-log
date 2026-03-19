/**
 * ocrDocument — 비영리 증빙 서류 OCR (Gemini API)
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getStorage } from "firebase-admin/storage";
import { defineString } from "firebase-functions/params";
import { GoogleGenAI } from "@google/genai";
import { checkRateLimitByUid } from "./rateLimit";
import { RATE_LIMITS, MAX_BASE64_SIZE } from "./constants";

const geminiApiKey = defineString("GEMINI_API_KEY");

interface OcrResult {
    orgName: string | null;
    bizNumber: string | null;
    repName: string | null;
    address: string | null;
    phone: string | null;
    isNonProfit: boolean | null;
    orgType: string | null;
    confidence: number;
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

/**
 * 사업자등록번호 패턴으로 비영리/영리 여부 분류
 * 82: 비영리, 80/81/89: 사단/재단 등
 */
function classifyByBizNumber(bizNumber: string): boolean | null {
    if (!bizNumber) return null;
    const cleaned = bizNumber.replace(/\D/g, "");
    if (cleaned.length < 5) return null;

    // 3~4번째 자리 (업태 코드)
    const typeCode = parseInt(cleaned.slice(3, 5), 10);

    // 비영리 코드: 80~89
    if (typeCode >= 80 && typeCode <= 89) return true;
    return false;
}

export const ocrDocument = onCall(
    {
        region: "asia-northeast3",
        timeoutSeconds: 120,
        memory: "512MiB",
        enforceAppCheck: true,
    },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }

        // Rate Limiting: 사용자당 분당 3회
        await checkRateLimitByUid("ocrDocument", request.auth.uid, RATE_LIMITS.ocrDocument.max, RATE_LIMITS.ocrDocument.windowSec);

        const { storagePath, imageBase64, mimeType } = request.data;

        if (!storagePath && !imageBase64) {
            throw new HttpsError("invalid-argument", "storagePath 또는 imageBase64가 필요합니다.");
        }

        // imageBase64 크기 제한 (~5MB 원본 = ~6.67MB base64)
        if (imageBase64 && imageBase64.length > MAX_BASE64_SIZE) {
            throw new HttpsError("invalid-argument", "이미지 크기가 너무 큽니다 (최대 5MB).");
        }

        try {
            let base64Data: string;
            let fileMimeType: string;

            if (imageBase64) {
                base64Data = imageBase64;
                fileMimeType = mimeType || "image/jpeg";
            } else {
                const downloaded = await downloadFileAsBase64(storagePath);
                base64Data = downloaded.base64;
                fileMimeType = downloaded.mimeType;
            }

            const ai = new GoogleGenAI({ apiKey: geminiApiKey.value() });

            const prompt = `이 서류 이미지에서 다음 정보를 추출해주세요:
1. 기관명/법인명/단체명
2. 사업자등록번호 (000-00-00000 형식)
3. 대표자명
4. 주소
5. 전화번호
6. 비영리/영리 여부 (있으면)
7. 기관 유형 (사회복지법인, 비영리사단법인, 재단법인, 학교법인, 종교단체 등)

반드시 아래 JSON 형식으로만 응답해주세요. 다른 텍스트 없이 JSON만:
{"orgName": "기관명", "bizNumber": "000-00-00000", "repName": "대표자", "address": "주소", "phone": "전화번호", "isNonProfit": true, "orgType": "비영리사단법인", "confidence": 0.9}

확인할 수 없는 값은 null로 표시하세요.`;

            const response = await ai.models.generateContent({
                model: "gemini-2.0-flash",
                contents: [
                    {
                        role: "user",
                        parts: [
                            {
                                inlineData: {
                                    mimeType: fileMimeType,
                                    data: base64Data,
                                },
                            },
                            { text: prompt },
                        ],
                    },
                ],
            });

            const text = response.text?.trim() || "";

            // JSON 파싱
            const result: OcrResult = {
                orgName: null,
                bizNumber: null,
                repName: null,
                address: null,
                phone: null,
                isNonProfit: null,
                orgType: null,
                confidence: 0,
                raw: text,
            };

            try {
                const jsonMatch = text.match(/\{[\s\S]*?\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    result.orgName = parsed.orgName || null;
                    result.bizNumber = parsed.bizNumber || null;
                    result.repName = parsed.repName || null;
                    result.address = parsed.address || null;
                    result.phone = parsed.phone || null;
                    result.isNonProfit = parsed.isNonProfit ?? null;
                    result.orgType = parsed.orgType || null;
                    result.confidence = parsed.confidence || 0;
                }
            } catch (parseErr) {
                console.error("OCR JSON 파싱 실패:", parseErr);
            }

            // 사업자번호로 비영리 여부 보조 판별
            if (result.isNonProfit === null && result.bizNumber) {
                result.isNonProfit = classifyByBizNumber(result.bizNumber);
            }

            console.log(`OCR 완료: ${result.orgName || "unknown"} (비영리: ${result.isNonProfit})`);

            return result;
        } catch (error: unknown) {
            console.error("OCR 오류:", (error as Error).message);
            throw new HttpsError("internal", "서류 인식에 실패했습니다.");
        }
    }
);
