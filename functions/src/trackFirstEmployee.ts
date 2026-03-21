/**
 * trackFirstEmployee — 첫 직원 등록 시점 자동 기록
 *
 * users/{uid} 문서가 생성될 때 해당 기관에 아직 firstEmployeeRegisteredAt이
 * 없으면 현재 시각과 승인일 대비 소요일(timeToFirstEmployeeDays)을 기록한다.
 */
import { onDocumentCreated } from "firebase-functions/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const db = getFirestore();

export const trackFirstEmployee = onDocumentCreated(
    {
        document: "users/{uid}",
        region: "asia-northeast3",
    },
    async (event) => {
        const userData = event.data?.data();
        if (!userData) return;

        const orgId = userData.organizationId as string | undefined;
        if (!orgId) return;

        // superAdmin은 기관 소속 직원이 아니므로 스킵
        if (userData.role === "superAdmin") return;

        try {
            const orgRef = db.collection("organizations").doc(orgId);
            const orgSnap = await orgRef.get();

            if (!orgSnap.exists) {
                console.warn(
                    `[trackFirstEmployee] 기관 문서 없음: ${orgId}`
                );
                return;
            }

            const orgData = orgSnap.data();

            // 이미 첫 직원이 기록된 경우 스킵
            if (orgData?.firstEmployeeRegisteredAt) {
                return;
            }

            const now = new Date();

            // 승인일 기준 소요일 계산 (approvedAt이 없으면 createdAt 사용)
            let baseDate: Date | null = null;
            if (orgData?.approvedAt) {
                baseDate = orgData.approvedAt.toDate
                    ? orgData.approvedAt.toDate()
                    : new Date(orgData.approvedAt);
            } else if (orgData?.createdAt) {
                baseDate = orgData.createdAt.toDate
                    ? orgData.createdAt.toDate()
                    : new Date(orgData.createdAt);
            }

            const updateData: Record<string, unknown> = {
                firstEmployeeRegisteredAt: FieldValue.serverTimestamp(),
            };

            if (baseDate && !isNaN(baseDate.getTime())) {
                const diffMs = now.getTime() - baseDate.getTime();
                const diffDays = Math.max(
                    0,
                    Math.round(diffMs / (1000 * 60 * 60 * 24))
                );
                updateData.timeToFirstEmployeeDays = diffDays;
            }

            await orgRef.update(updateData);

            console.log(
                `[trackFirstEmployee] 기록 완료: orgId=${orgId}, days=${updateData.timeToFirstEmployeeDays ?? "N/A"}`
            );
        } catch (err) {
            console.error(
                `[trackFirstEmployee] 처리 실패: orgId=${orgId}`,
                err
            );
        }
    }
);
