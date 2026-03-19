/**
 * ocrDashboard — 계기판 OCR (Gemini API)
 */
import { onCall, HttpsError } from "firebase-functions/https";
import { GoogleGenAI } from "@google/genai";
import { defineString } from "firebase-functions/params";
import { checkRateLimitByUid } from "./rateLimit";
import { RATE_LIMITS, MAX_BASE64_SIZE } from "./constants";

const geminiApiKey = defineString("GEMINI_API_KEY");

export const ocrDashboard = onCall(
    {
        region: "asia-northeast3",
        timeoutSeconds: 60,
        memory: "512MiB",
        enforceAppCheck: true,
    },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }

        // Rate Limiting: 사용자당 분당 5회
        await checkRateLimitByUid("ocrDashboard", request.auth.uid, RATE_LIMITS.ocrDashboard.max, RATE_LIMITS.ocrDashboard.windowSec);

        const { imageBase64, mimeType, isElectric } = request.data;

        if (!imageBase64) {
            throw new HttpsError("invalid-argument", "이미지 데이터가 필요합니다.");
        }

        // imageBase64 크기 제한 (~5MB 원본 = ~6.67MB base64)
        if (imageBase64.length > MAX_BASE64_SIZE) {
            throw new HttpsError("invalid-argument", "이미지 크기가 너무 큽니다 (최대 5MB).");
        }

        try {
            const ai = new GoogleGenAI({ apiKey: geminiApiKey.value() });

            const prompt = isElectric
                ? `이 자동차 계기판(dashboard/instrument cluster) 사진에서 **누적 주행거리(오도미터, ODO)**와 **배터리 잔량(%)**을 찾아주세요.

## 핵심 구분 규칙
- **오도미터(ODO)**: 차량 출고 이후 총 누적 주행거리. 보통 5~6자리 이상의 큰 숫자. "ODO" 라벨 근처에 표시됨.
- **트립미터(TRIP A/B)**: 구간별 주행거리. 보통 작은 숫자(수백 이하). "TRIP" 라벨 근처에 표시됨. ❌ 이것은 누적 주행거리가 아닙니다.
- 숫자가 여러 개 보이면, "ODO" 라벨이 있는 숫자 또는 **가장 큰 숫자**가 누적 주행거리일 가능성이 높습니다.
- 숫자에 콤마(,)나 소수점(.)이 포함될 수 있습니다. 소수점 이하는 버리고 정수 km만 추출하세요. (예: 12,345.6 → 12345)

## 배터리 잔량
- 전기차 계기판에서 배터리 아이콘(🔋) 또는 "%" 표시 근처의 숫자를 찾아주세요.
- 0~100 사이의 정수로 추출하세요.

반드시 아래 JSON 형식으로만 응답해주세요. 다른 텍스트는 포함하지 마세요:
{"km": 숫자, "battery": 숫자}

값을 확인할 수 없는 경우 null로 표시해주세요.`
                : `이 자동차 계기판(dashboard/instrument cluster) 사진에서 **누적 주행거리(오도미터, ODO)**를 찾아주세요.

## 핵심 구분 규칙
- **오도미터(ODO)**: 차량 출고 이후 총 누적 주행거리. 보통 5~6자리 이상의 큰 숫자. "ODO" 라벨 근처에 표시됨.
- **트립미터(TRIP A/B)**: 구간별 주행거리. 보통 작은 숫자(수백 이하). "TRIP" 라벨 근처에 표시됨. ❌ 이것은 누적 주행거리가 아닙니다.
- 숫자가 여러 개 보이면, "ODO" 라벨이 있는 숫자 또는 **가장 큰 숫자**가 누적 주행거리일 가능성이 높습니다.
- 숫자에 콤마(,)나 소수점(.)이 포함될 수 있습니다. 소수점 이하는 버리고 정수 km만 추출하세요. (예: 12,345.6 → 12345)

반드시 아래 JSON 형식으로만 응답해주세요. 다른 텍스트는 포함하지 마세요:
{"km": 숫자}

값을 확인할 수 없는 경우 null로 표시해주세요.`;

            const response = await ai.models.generateContent({
                model: "gemini-3.1-flash-lite-preview",
                contents: [
                    {
                        role: "user",
                        parts: [
                            {
                                inlineData: {
                                    mimeType: mimeType || "image/jpeg",
                                    data: imageBase64,
                                },
                            },
                            { text: prompt },
                        ],
                    },
                ],
            });

            const text = (response.text ?? "").trim();

            // JSON 파싱 시도
            const result: { km: number | null; battery: number | null } = { km: null, battery: null };
            try {
                const jsonMatch = text.match(/\{[\s\S]*?\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    result.km = parsed.km != null ? Number(parsed.km) : null;
                    result.battery = parsed.battery != null ? Number(parsed.battery) : null;
                }
            } catch (parseErr) {
                // JSON 파싱 실패 시 숫자만 추출 시도
                const numbers = text.match(/\d+/g);
                if (numbers && numbers.length > 0) {
                    result.km = Number(numbers[0]);
                    if (isElectric && numbers.length > 1) {
                        result.battery = Number(numbers[1]);
                    }
                }
            }

            return {
                km: result.km,
                battery: result.battery,
                raw: text,
            };
        } catch (error: unknown) {
            console.error("계기판 OCR 오류:", error);
            throw new HttpsError("internal", "계기판 인식에 실패했습니다. 다시 시도해주세요.");
        }
    }
);
