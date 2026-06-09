import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { sendDiscordAlert } from "../../core/discord";

export const notifyRoleChange = onDocumentWritten(
    "users/{uid}",
    async (event) => {
        const before = event.data?.before.data();
        const after = event.data?.after.data();
        
        if (!after) return; // 데이터가 완전히 삭제된 경우 무시
        
        const oldRole = before?.role || "user";
        const newRole = after.role || "user";

        // 기존 권한이 superAdmin이 아니었는데, superAdmin으로 변경된 경우 (보안 알림)
        if (oldRole !== "superAdmin" && newRole === "superAdmin") {
            const userName = after.name || "이름 없음";
            const email = after.email || "이메일 없음";
            const orgId = after.organizationId || "기관 없음";
            
            await sendDiscordAlert({
                title: `🚨 치명적 권한 변경 경고`,
                description: `사용자 **${userName}** 에게 시스템 전체 접근 권한(\`superAdmin\`)이 부여되었습니다.\n이 변경이 의도된 권한 부여인지 즉시 확인하세요.`,
                color: 16711680, // Error Red (16진수 FF0000)
                fields: [
                    { name: "사용자명", value: userName, inline: true },
                    { name: "이메일", value: email, inline: true },
                    { name: "추정 소속(Org ID)", value: orgId, inline: false }
                ]
            }).catch(e => console.error("Discord alert error:", e));
        }
    }
);
