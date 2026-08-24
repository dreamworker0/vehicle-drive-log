/**
 * 백필 스크립트: 기존 기관들의 firstEmployeeRegisteredAt 소급 적용
 *
 * 사용법:
 *   npx ts-node scripts/backfillFirstEmployee.ts
 *
 * 필요 환경변수:
 *   GOOGLE_APPLICATION_CREDENTIALS — Firebase Admin SDK 서비스 계정 키 경로
 */
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { initAdminApp } from "./lib/adminApp";

// 자격증명(서비스 계정 키 → ADC)과 **대상 프로젝트 고정**은 lib/adminApp이 맡는다.
// 예전에는 키 파일 읽기가 실패하면 맨손 initializeApp()으로 넘어가, ADC 기본 프로젝트를
// 상대로 **백필을 실행**할 수 있었다.
const app = initAdminApp();

const db = getFirestore(app);

async function backfill() {
    console.log("=== 백필 시작: firstEmployeeRegisteredAt ===\n");

    // 1. 승인된 기관 중 firstEmployeeRegisteredAt이 없는 기관 조회
    const orgsSnap = await db
        .collection("organizations")
        .where("status", "==", "approved")
        .get();

    const orgsToProcess = orgsSnap.docs.filter(
        (doc) => !doc.data().firstEmployeeRegisteredAt
    );

    console.log(
        `총 승인 기관: ${orgsSnap.size}개, 백필 대상: ${orgsToProcess.length}개\n`
    );

    let updated = 0;
    let skipped = 0;
    let noEmployee = 0;

    for (const orgDoc of orgsToProcess) {
        const orgData = orgDoc.data();
        const orgName = orgData.name || orgDoc.id;

        // 2. 해당 기관에 소속된 직원 중 가장 먼저 등록된 사용자 찾기
        const usersSnap = await db
            .collection("users")
            .where("organizationId", "==", orgDoc.id)
            .orderBy("createdAt", "asc")
            .limit(1)
            .get();

        if (usersSnap.empty) {
            noEmployee++;
            continue;
        }

        const firstUser = usersSnap.docs[0].data();
        const firstUserCreatedAt = firstUser.createdAt;

        if (!firstUserCreatedAt) {
            skipped++;
            console.log(`  ⚠ ${orgName}: 첫 직원의 createdAt 없음, 스킵`);
            continue;
        }

        const employeeDate: Date = firstUserCreatedAt instanceof Timestamp
            ? firstUserCreatedAt.toDate()
            : new Date(firstUserCreatedAt);

        // 3. 소요일 계산 (approvedAt 또는 createdAt 기준)
        let baseDate: Date | null = null;
        if (orgData.approvedAt) {
            baseDate = orgData.approvedAt instanceof Timestamp
                ? orgData.approvedAt.toDate()
                : new Date(orgData.approvedAt);
        } else if (orgData.createdAt) {
            baseDate = orgData.createdAt instanceof Timestamp
                ? orgData.createdAt.toDate()
                : new Date(orgData.createdAt);
        }

        const updateData: Record<string, unknown> = {
            firstEmployeeRegisteredAt: firstUserCreatedAt,
        };

        if (baseDate && !isNaN(baseDate.getTime())) {
            const diffMs = employeeDate.getTime() - baseDate.getTime();
            const diffDays = Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
            updateData.timeToFirstEmployeeDays = diffDays;
            console.log(`  ✅ ${orgName}: ${diffDays}일 소요`);
        } else {
            console.log(`  ✅ ${orgName}: 소요일 계산 불가 (기준일 없음)`);
        }

        await db.collection("organizations").doc(orgDoc.id).update(updateData);
        updated++;
    }

    console.log(`\n=== 백필 완료 ===`);
    console.log(`  업데이트: ${updated}개`);
    console.log(`  직원 없음: ${noEmployee}개`);
    console.log(`  스킵: ${skipped}개`);
}

backfill().catch(console.error);
