import * as logger from "firebase-functions/logger";

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";

export interface DiscordAlertOptions {
    title: string;
    description: string;
    color?: number; // 디스코드 색상 코드 (기본: 빨간색)
    fields?: { name: string; value: string; inline?: boolean }[];
}

/**
 * Discord Webhook으로 알림 메시지(Embed 형태)를 전송합니다.
 * 환경 변수 DISCORD_WEBHOOK_URL이 설정되어 있어야 동작합니다.
 * @param options 알림 제목, 내용, 색상 및 필드
 */
export async function sendDiscordAlert({
    title,
    description,
    color = 16711680, // Error Red (16진수 FF0000)
    fields = [],
}: DiscordAlertOptions): Promise<void> {
    if (!DISCORD_WEBHOOK_URL) {
        // 웹훅 URL이 설정되지 않은 로컬/테스트 환경에서는 조용히 넘어갑니다.
        return;
    }

    try {
        const response = await fetch(DISCORD_WEBHOOK_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                embeds: [
                    {
                        title,
                        description: description.substring(0, 4000), // Discord 본문 길이 제한 방어
                        color,
                        timestamp: new Date().toISOString(),
                        fields,
                    },
                ],
            }),
        });

        if (!response.ok) {
            logger.warn(`[Discord Webhook] Failed with status: ${response.status}`);
        }
    } catch (e) {
        logger.error("[Discord Webhook] Request error", e);
    }
}
