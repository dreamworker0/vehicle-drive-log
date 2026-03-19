/**
 * autoPurgeOrgs — 매일 새벽 4시(KST) soft-deleted 기관 30일 후 영구 삭제
 */
import { getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";

export const autoPurgeOrgs = onSchedule(
    {
        schedule: "0 19 * * *", // UTC 19:00 = KST 04:00
        timeZone: "Asia/Seoul",
        retryCount: 1,
    },
    async function () {
        const db = getFirestore();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        try {
            const deletedOrgsSnap = await db
                .collection("organizations")
                .where("status", "==", "deleted")
                .where("deletedAt", "<=", thirtyDaysAgo)
                .get();

            if (deletedOrgsSnap.empty) {
                console.log("No organizations to purge.");
                return;
            }

            let totalPurged = 0;

            for (const orgDoc of deletedOrgsSnap.docs) {
                const orgId = orgDoc.id;
                const orgName = (orgDoc.data().name as string) || orgId;

                try {
                    const usersSnap = await db
                        .collection("users")
                        .where("organizationId", "==", orgId)
                        .get();

                    const batch = db.batch();
                    usersSnap.docs.forEach((userDoc) => {
                        batch.delete(userDoc.ref);
                    });
                    batch.delete(orgDoc.ref);
                    await batch.commit();

                    totalPurged++;
                    console.log(`Purged org "${orgName}" (${orgId}) with ${usersSnap.size} users`);
                } catch (err: unknown) {
                    console.error(`Failed to purge org "${orgName}" (${orgId}):`, (err as Error).message);
                }
            }

            console.log(`Auto-purge complete: ${totalPurged} organizations permanently deleted.`);
        } catch (err: unknown) {
            console.error("Auto-purge failed:", (err as Error).message);
        }
    }
);
