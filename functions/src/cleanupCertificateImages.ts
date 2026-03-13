/**
 * cleanupCertificateImages — 매일 KST 새벽 4시 실행
 * 승인 후 30일 경과한 기관의 고유번호증 사본을 Storage에서 삭제하고
 * Firestore uniqueNumberImageUrl 필드를 초기화한다.
 */
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onSchedule } from "firebase-functions/v2/scheduler";

export const cleanupCertificateImages = onSchedule(
    {
        schedule: "0 19 * * *", // UTC 19:00 = KST 04:00
        timeZone: "Asia/Seoul",
        retryCount: 1,
    },
    async function () {
        const db = getFirestore();
        const bucket = getStorage().bucket();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        try {
            // 승인된 기관 중 approvedAt이 30일 이전이고 uniqueNumberImageUrl이 존재하는 기관
            const orgsSnap = await db
                .collection("organizations")
                .where("status", "==", "approved")
                .where("approvedAt", "<=", thirtyDaysAgo)
                .get();

            if (orgsSnap.empty) {
                console.log("No certificate images to clean up.");
                return;
            }

            let totalCleaned = 0;

            for (const orgDoc of orgsSnap.docs) {
                const orgId = orgDoc.id;
                const data = orgDoc.data();
                const imageUrl = data.uniqueNumberImageUrl as string;

                // 이미 삭제되었거나 비어있으면 스킵
                if (!imageUrl) continue;

                const orgName = (data.name as string) || orgId;

                try {
                    // Storage에서 파일 삭제 (jpg, pdf 모두 시도)
                    const extensions = ["jpg", "pdf"];
                    for (const ext of extensions) {
                        const filePath = `organizations/${orgId}/uniqueNumberImage.${ext}`;
                        const file = bucket.file(filePath);
                        const [exists] = await file.exists();
                        if (exists) {
                            await file.delete();
                            console.log(`Deleted: ${filePath}`);
                        }
                    }

                    // Firestore URL 필드 초기화
                    await orgDoc.ref.update({ uniqueNumberImageUrl: "" });
                    totalCleaned++;
                    console.log(`Cleaned certificate for "${orgName}" (${orgId})`);
                } catch (err: unknown) {
                    console.error(
                        `Failed to clean certificate for "${orgName}" (${orgId}):`,
                        (err as Error).message
                    );
                }
            }

            console.log(`Certificate cleanup complete: ${totalCleaned} images deleted.`);
        } catch (err: unknown) {
            console.error("Certificate cleanup failed:", (err as Error).message);
        }
    }
);
