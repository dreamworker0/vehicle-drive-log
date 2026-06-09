import { defineString } from "firebase-functions/params";
import { GoogleGenAI } from "@google/genai";

const geminiApiKey = defineString("GEMINI_API_KEY");

let aiInstance: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
    if (!aiInstance) {
        aiInstance = new GoogleGenAI({ apiKey: geminiApiKey.value() });
    }
    return aiInstance;
}

export async function generateAiContent(
    prompt: string,
    image?: { mimeType: string; data: string } | Array<{ mimeType: string; data: string }>,
    model = "gemini-3.1-flash-lite",
    config?: Record<string, any>
): Promise<string> {
    const ai = getGeminiClient();
    const contents: any[] = [];
    
    if (image) {
        if (Array.isArray(image)) {
            image.forEach(img => {
                contents.push({
                    inlineData: {
                        mimeType: img.mimeType,
                        data: img.data,
                    }
                });
            });
        } else {
            contents.push({
                inlineData: {
                    mimeType: image.mimeType,
                    data: image.data,
                }
            });
        }
    }
    
    contents.push({ text: prompt });
    
    const response = await ai.models.generateContent({
        model,
        contents,
        config,
    });
    
    return response.text?.trim() || "";
}
