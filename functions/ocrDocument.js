const { onCall, HttpsError } = require("firebase-functions/https");
const { GoogleGenAI } = require("@google/genai");
const { defineString } = require("firebase-functions/params");
const { getStorage } = require("firebase-admin/storage");

const geminiApiKey = defineString("GEMINI_API_KEY");

/**
 * Firebase Storage download URL에서 파일을 다운로드하여 base64로 변환
 * @param {string} downloadUrl - Firebase Storage download URL
 * @returns {Promise<{base64: string, mimeType: string}>}
 */
async function downloadFileAsBase64(downloadUrl) {
    const storage = getStorage();
    // download URL에서 파일 경로 추출: /o/<encodedPath>?
    const pathMatch = downloadUrl.match(/\/o\/(.+?)\?/);
    if (!pathMatch) {
        throw new Error("유효하지 않은 Storage URL입니다: " + downloadUrl);
    }
    const filePath = decodeURIComponent(pathMatch[1]);
    const isPdf = filePath.toLowerCase().endsWith(".pdf");
    const mimeType = isPdf ? "application/pdf" : "image/jpeg";

    const [buffer] = await storage.bucket().file(filePath).download();
    return {
        base64: buffer.toString("base64"),
        mimeType,
    };
}

/**
 * 사업자번호 중간 2자리 + 키워드 기반 비영리 판별 보조 함수
 * - 82: 비영리 고유번호 체계 (+40)
 * - 81: 영리 법인 (-40)
 * - 80: 영리 개인사업자 (-30)
 * - 키워드: 사단법인/재단법인/사회복지(+), 주식회사/유한회사(-)
 */
function classifyByBizNumber(bizNumber, orgName, documentType) {
    let score = 0;

    // 고유번호증이면 즉시 비영리 확정
    if (documentType === "고유번호증") {
        return { score: 100, result: "비영리 확정" };
    }

    // 사업자번호 중간 2자리 추출
    if (bizNumber) {
        const bizMatch = bizNumber.match(/\d{3}-(\d{2})-\d{5}/);
        const mid = bizMatch ? bizMatch[1] : null;

        if (mid === "82") score += 40;      // 비영리 고유번호 체계
        else if (mid === "81") score -= 40; // 영리 법인
        else if (mid === "80") score -= 30; // 영리 개인사업자
    }

    // 단체명 키워드 분석
    const name = (orgName || "").toLowerCase();
    if (name.includes("사단법인")) score += 30;
    if (name.includes("재단법인")) score += 30;
    if (name.includes("사회복지")) score += 40;
    if (name.includes("비영리")) score += 30;
    if (name.includes("복지관")) score += 20;
    if (name.includes("복지센터")) score += 20;
    if (name.includes("주식회사") || name.includes("(주)")) score -= 50;
    if (name.includes("유한회사") || name.includes("유한책임")) score -= 40;

    return { score };
}

/**
 * 비영리 증빙서류 OCR — 업로드된 문서 이미지에서 정보 추출 + 검증
 * 
 * @param {object} data - { imageUrl: string, orgName: string }
 * @returns {{ documentType, uniqueNumber, extractedName, nameMatch, address, aiVerified, rejected, rejectReason }}
 */
exports.ocrDocument = onCall(
    {
        region: "asia-northeast3",
        timeoutSeconds: 120,
        memory: "512MiB",
    },
    async (request) => {
        // 인증 확인
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }

        const { imageUrl, orgName } = request.data;

        if (!imageUrl || !orgName) {
            throw new HttpsError("invalid-argument", "이미지 URL과 기관명이 필요합니다.");
        }

        try {
            const ai = new GoogleGenAI({ apiKey: geminiApiKey.value() });

            const prompt = `이 문서 이미지를 분석해주세요. 이 문서는 한국의 공문서입니다.

다음 정보를 추출하고 판단해주세요:

1. "documentType": 문서 유형을 판별해주세요. 다음 중 하나:
   - "고유번호증" — 비영리법인/단체의 고유번호증
   - "사업자등록증(비영리)" — 비영리법인/단체의 사업자등록증 (법인 종류가 비영리사단법인, 비영리재단법인, 사회복지법인, 비영리민간단체 등에 해당)
   - "사업자등록증(영리)" — 영리 목적의 일반 기업 사업자등록증 (주식회사, 유한회사, 개인사업자 등)
   - "기타" — 위에 해당하지 않는 경우

   판별 팁: 사업자등록증에서 '법인명(단체명)', '법인등록번호', '종목', '업태' 등을 확인하세요.
   비영리법인은 보통 법인 종류에 '비영리', '사회복지', '재단법인', '사단법인' 등이 포함됩니다.

2. "uniqueNumber": 고유번호(또는 사업자등록번호) 추출 (예: "123-82-12345")

3. "extractedName": 문서에 기재된 단체명(기관명, 법인명, 상호) 추출

4. "address": 문서에 기재된 소재지(주소) 추출

5. "nameMatch": 입력된 기관명 "${orgName}"과 추출된 단체명이 의미상 일치하는지 판단 (true/false)
   - 약칭이나 부분 포함도 일치로 판단 (예: "행복복지관" ↔ "사회복지법인 행복복지관" → true)

반드시 아래 JSON 형식으로만 응답해주세요:
{
  "documentType": "고유번호증 또는 사업자등록증(비영리) 또는 사업자등록증(영리) 또는 기타",
  "uniqueNumber": "추출된 번호",
  "extractedName": "추출된 단체명",
  "address": "추출된 주소",
  "nameMatch": true 또는 false
}

값을 확인할 수 없는 경우 null로 표시해주세요.`;

            // Storage에서 파일 다운로드 → base64 변환
            const fileInfo = await downloadFileAsBase64(imageUrl);

            const response = await ai.models.generateContent({
                model: "gemini-3.1-flash-lite-preview",
                contents: [
                    {
                        role: "user",
                        parts: [
                            {
                                inlineData: {
                                    data: fileInfo.base64,
                                    mimeType: fileInfo.mimeType,
                                },
                            },
                            { text: prompt },
                        ],
                    },
                ],
            });

            const text = response.text.trim();

            // JSON 파싱
            let result = {
                documentType: "기타",
                uniqueNumber: null,
                extractedName: null,
                nameMatch: false,
                address: null,
            };

            try {
                const jsonMatch = text.match(/\{[\s\S]*?\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    result.documentType = parsed.documentType || "기타";
                    result.uniqueNumber = parsed.uniqueNumber || null;
                    result.extractedName = parsed.extractedName || null;
                    result.nameMatch = parsed.nameMatch === true;
                    result.address = parsed.address || null;
                }
            } catch (parseErr) {
                console.warn("비영리 증빙서류 OCR JSON 파싱 실패:", parseErr, "원본:", text);
            }

            // 검증 결과 판단
            // 사업자번호 중간 2자리 + 키워드 기반 보조 판별
            const bizScore = classifyByBizNumber(result.uniqueNumber, result.extractedName, result.documentType);

            let finalDocType = result.documentType;
            // AI가 "기타"로 판별했지만 번호/키워드로 비영리 확인 → 보정
            if (finalDocType === "기타" && bizScore.score >= 50) {
                finalDocType = "사업자등록증(비영리)";
            }
            // AI가 비영리로 판별했지만 번호가 영리 패턴 → 관리자 검토로 전환
            if (finalDocType === "사업자등록증(비영리)" && bizScore.score <= -30) {
                finalDocType = "사업자등록증(영리)";
            }

            const isForProfit = finalDocType === "사업자등록증(영리)";
            const isNonProfit =
                finalDocType === "고유번호증" ||
                finalDocType === "사업자등록증(비영리)";
            const aiVerified =
                isNonProfit &&
                result.nameMatch === true &&
                result.uniqueNumber != null;

            return {
                documentType: finalDocType,
                uniqueNumber: result.uniqueNumber,
                extractedName: result.extractedName,
                nameMatch: result.nameMatch,
                address: result.address,
                aiVerified,
                rejected: isForProfit,
                rejectReason: isForProfit
                    ? "영리 목적의 사업자등록증이 제출되었습니다. 본 서비스는 비영리단체 전용입니다."
                    : null,
                bizScore: bizScore.score,
                raw: text,
            };
        } catch (error) {
            console.error("비영리 증빙서류 OCR 오류:", error);
            throw new HttpsError("internal", "문서 인식에 실패했습니다. 다시 시도해주세요.");
        }
    }
);
