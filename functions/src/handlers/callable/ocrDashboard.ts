/**
 * ocrDashboard — 계기판 OCR (Gemini API)
 */
import { GEMINI_API_KEY } from "../../core/params";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { generateAiContent } from "../../core/gemini";
import { wrapCallableHandler } from "../../utils/helpers";
import { MAX_BASE64_SIZE, getRateLimits } from "../../utils/constants";
import { checkDailyOcrQuota } from "../../utils/rateLimit";

/**
 * 계기판 값 하나를 정수로 — 못 읽으면 null.
 *
 * 프롬프트는 숫자를 요구하지만 Gemini가 `"12,345"`·`"12,345.6 km"`처럼 **문자열**로 줄 때가 있다.
 * 예전에는 `Number()`를 그대로 써서 NaN이 나갔고, 화면은 `km != null`만 보고 도착 km 칸에
 * "NaN"을 채웠다(2026-10-16 테스트 중 발견). 콤마·공백·단위를 걷어내고 소수점 아래는 버린다.
 */
function toReading(value: unknown, max: number): number | null {
    let n: number;
    if (typeof value === "number") {
        n = value;
    } else if (typeof value === "string") {
        const m = value.replace(/[,\s]/g, "").match(/\d+(?:\.\d+)?/);
        if (!m) return null;
        n = Number(m[0]);
    } else {
        return null;
    }
    if (!Number.isFinite(n) || n < 0 || n > max) return null;
    return Math.floor(n);
}

/** 누적 주행거리 상한 — 이보다 크면 판독 오류로 본다(실차 오도미터는 7자리를 넘지 않는다) */
const MAX_ODOMETER_KM = 9_999_999;

/** Gemini 응답 → { km, battery }. JSON이 깨졌으면 숫자(콤마 포함)만 뽑는다. 테스트가 직접 쓴다. */
export function parseDashboardReading(text: string, isElectric: boolean): { km: number | null; battery: number | null } {
    const result: { km: number | null; battery: number | null } = { km: null, battery: null };
    try {
        const jsonMatch = text.match(/\{[\s\S]*?\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            result.km = toReading(parsed.km, MAX_ODOMETER_KM);
            result.battery = toReading(parsed.battery, 100);
        }
    } catch {
        // JSON 파싱 실패 시 숫자만 추출 시도 — "12,345"를 12와 345로 쪼개지 않게 콤마째 잡는다
        const numbers = text.match(/\d[\d,]*(?:\.\d+)?/g);
        if (numbers && numbers.length > 0) {
            result.km = toReading(numbers[0], MAX_ODOMETER_KM);
            if (isElectric && numbers.length > 1) {
                result.battery = toReading(numbers[1], 100);
            }
        }
    }
    return result;
}

export const ocrDashboard = onCall(
    {
        region: "asia-northeast3",
        secrets: [GEMINI_API_KEY],
        timeoutSeconds: 60,
        memory: "512MiB",
        enforceAppCheck: true,
    },
    wrapCallableHandler("ocrDashboard", { rateLimitKey: "ocrDashboard", rateLimitFailMode: "closed" }, async (request) => {
        const { imageBase64, mimeType, isElectric } = request.data as { imageBase64?: string; mimeType?: string; isElectric?: boolean };

        if (!imageBase64) {
            throw new HttpsError("invalid-argument", "이미지 데이터가 필요합니다.");
        }

        // imageBase64 크기 제한 (~5MB 원본 = ~6.67MB base64)
        if (imageBase64.length > MAX_BASE64_SIZE) {
            throw new HttpsError("invalid-argument", "이미지 크기가 너무 큽니다 (최대 5MB).");
        }

        // 일일 누적 한도(사용자/조직) — 분 단위 제한과 별개의 비용 증폭 방어 (ocr-cost-security §1.1).
        // 입력 검증 **뒤에** 센다 — 앞에 두면 사진이 없거나 너무 큰 요청(Gemini를 부르지 않는다)도
        // 하루 한도를 깎았다(2026-10-16). 분 단위 상한은 래퍼가 맨 앞에서 그대로 막는다.
        const [dailyUser, dailyOrg] = await Promise.all([getRateLimits("ocrDailyUser"), getRateLimits("ocrDailyOrg")]);
        await checkDailyOcrQuota(request.auth!.uid, request.auth!.token.orgId as string | undefined, dailyUser, dailyOrg);

        const prompt = isElectric
            ? `이 자동차 계기판(dashboard/instrument cluster) 사진에서 **누적 주행거리(오도미터, ODO)**와 **배터리 잔량(%)**을 찾아주세요.

## 핵심 구분 규칙
- **오도미터(ODO)**: 차량 출고 이후 총 누적 주행거리. 보통 5~6자리 이상의 큰 숫자. "ODO" 라벨 근처에 표시됨.
- **트립미터(TRIP A/B)**: 구간별 주행거리. 보통 작은 숫자(수백 이하). "TRIP" 라벨 근처에 표시됨. ❌ 이것은 누적 주행거리가 아닙니다.
- 숫자가 여러 개 보이면, "ODO" 라벨이 있는 숫자 또는 **가장 큰 숫자**가 누적 주행거리일 가능성이 높습니다.
- 숫자에 콤마(,)나 소수점(.)이 포함될 수 있습니다. 소수점 이하는 버리고 정수 km만 추출하세요. (예: 12,345.6 → 12345)
- **악조건 추론**: 사진에 빛 반사(글레어), 그림자, 먼지 얼룩이 있거나 일부 숫자가 흐릿해도 5~6자리 형태의 숫자를 우선적으로 찾아내세요. 먼지로 인해 '8'이 'B'로, '0'이 알파벳 'O'나 'C' 등으로 보일 수 있으니 문맥상 숫자로 유추하여 판독하세요.

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
- 숫자가 여러 개 보이면, "ODO" 라벨이 있는 숫자 또는 **가장 큰 숫자**가 누적 주행거리일 가능스가 높습니다.
- 숫자에 콤마(,)나 소수점(.)이 포함될 수 있습니다. 소수점 이하는 버리고 정수 km만 추출하세요. (예: 12,345.6 → 12345)
- **악조건 추론**: 사진에 빛 반사(글레어), 그림자, 먼지 얼룩이 있거나 일부 숫자가 흐릿해도 5~6자리 형태의 숫자를 우선적으로 찾아내세요. 먼지로 인해 '8'이 'B'로, '0'이 알파벳 'O'나 'C' 등으로 보일 수 있으니 문맥상 숫자로 유추하여 판독하세요.

반드시 아래 JSON 형식으로만 응답해주세요. 다른 텍스트는 포함하지 마세요:
{"km": 숫자}

값을 확인할 수 없는 경우 null로 표시해주세요.`;

        const text = await generateAiContent(
            prompt,
            {
                mimeType: mimeType || "image/jpeg",
                data: imageBase64,
            }
        );

        const result = parseDashboardReading(text, !!isElectric);

        return {
            km: result.km,
            battery: result.battery,
            raw: text,
        };
    })
);
