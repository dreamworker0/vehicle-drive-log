---
name: gemini-ocr-integration
description: Gemini 3.1 Flash Lite API를 사용한 계기판 OCR 및 증빙 서류 AI 판별 연동 패턴 가이드
---

# 🤖 Gemini OCR & AI 분석 연동 패턴

이 가이드는 Firebase Cloud Functions 환경에서 Google Gemini 3.1 Flash Lite API를 활용해 차량 계기판 이미지(누적 주행거리 km, 배터리 잔량 추출) 및 비영리단체 고유번호증 등 증빙 서류를 서버사이드에서 분석하는 표준 구현 패턴을 정의합니다.

---

## 1. 공통 모듈 개요

프로젝트의 모든 Gemini API 호출은 개별적으로 인스턴스를 생성하지 않고, 싱글톤 클라이언트와 공통 유틸 함수가 정의된 [gemini.ts](file:///d:/apps/차량운행일지/functions/src/core/gemini.ts)를 사용해야 합니다.

### 핵심 API 인터페이스
*   `getGeminiClient()`: `GoogleGenAI` 싱글톤 객체를 반환합니다.
*   `generateAiContent(prompt, image?, model?, config?)`: 텍스트 프롬프트와 이미지 데이터(단일/배열)를 받아 Gemini 모델의 텍스트 결과를 반환합니다.
    *   **기본 모델**: `gemini-3.1-flash-lite`

---

## 2. 권장 구현 패턴

### 2.1 이미지(OCR) 데이터 전송 규격
프론트엔드에서 업로드한 이미지 데이터를 Cloud Functions로 전달할 때에는 Base64 포맷으로 전송하며, `generateAiContent`에는 다음과 같은 형식으로 전달합니다.

```typescript
import { generateAiContent } from "../../core/gemini";

// 단일 이미지 분석 예시
const imageInput = {
    mimeType: "image/jpeg",
    data: "iVBORw0KGgoAAAANSUhEUgAA...", // Base64 인코딩 스트링 (데이터 헤더 제거 필수)
};

const prompt = "이 계기판 이미지에서 누적 주행거리(km)와 배터리 잔량(%)을 찾아내어 추출해줘.";
const resultText = await generateAiContent(prompt, imageInput);
```

### 2.2 구조화된 JSON 응답 강제화 (Structured Output)
AI 분석 결과가 자바스크립트 객체로 즉시 파싱될 수 있도록 `responseMimeType` 및 `responseSchema`를 활용하여 구조화된 JSON 출력을 강제화합니다.

```typescript
import { Type } from "@google/genai";
import { generateAiContent } from "../../core/gemini";

const prompt = "고유번호증 사본 이미지에서 단체명과 고유번호(사업자등록번호 형식)를 추출하라.";

const result = await generateAiContent(
    prompt,
    imageInput,
    "gemini-3.1-flash-lite",
    {
        responseMimeType: "application/json",
        responseSchema: {
            type: Type.OBJECT,
            properties: {
                organizationName: { type: Type.STRING, description: "단체명" },
                uniqueNumber: { type: Type.STRING, description: "고유번호 (예: 123-82-45678)" },
                isValid: { type: Type.BOOLEAN, description: "유효한 비영리 고유번호증 사본인지 여부" }
            },
            required: ["organizationName", "uniqueNumber", "isValid"]
        }
    }
);

const parsedData = JSON.parse(result);
```

---

## 3. 유의사항 및 에러 핸들링

1.  **할당량 초과 핸들링**: Gemini API는 호출당 쿼터 제한이 발생할 수 있습니다. 호출 시 반드시 `try-catch` 블록으로 래핑하고, Sentry에 에러를 로깅하되 사용자에게는 정제된 에러 메시지를 제공합니다.
2.  **민감 정보 보안**: `GEMINI_API_KEY`는 코드 내 하드코딩을 절대 금지하며, Firebase Functions Parameters인 `defineString` 또는 `functions/.env` 환경변수를 통해서만 주입되도록 합니다.
3.  **이미지 크기 최적화**: 너무 해상도가 큰 이미지는 API 호출 시 지연 시간(Latency)을 늘리고 타임아웃을 유발할 수 있으므로, 프론트엔드단에서 가급적 리사이징(예: 최대 1200px 너비)하여 업로드하도록 권장합니다.

---

## 4. 테스트 모킹 가이드 (Vitest)

단위 테스트를 실행할 때 실제 Gemini API 호출이 발생하지 않도록 모킹해야 합니다. `vi.mock`을 이용하여 `generateAiContent`의 반환값을 시뮬레이션합니다.

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ocrDashboardHandler } from "./ocrDashboard";

// gemini core 모듈 모킹
vi.mock("../../core/gemini", () => ({
    generateAiContent: vi.fn(),
    getGeminiClient: vi.fn()
}));

import { generateAiContent } from "../../core/gemini";

describe("ocrDashboard 핸들러 테스트", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("올바른 계기판 이미지 분석 시 JSON 객체를 파싱하여 반환해야 한다", async () => {
        // Mock 반환값 설정
        const mockResponse = JSON.stringify({
            accumulatedKm: 12345,
            batteryPercent: 88
        });
        vi.mocked(generateAiContent).mockResolvedValue(mockResponse);

        const result = await ocrDashboardHandler({ imageBase64: "test-base64" });

        expect(result.accumulatedKm).toBe(12345);
        expect(result.batteryPercent).toBe(88);
        expect(generateAiContent).toHaveBeenCalledTimes(1);
    });
});
```
