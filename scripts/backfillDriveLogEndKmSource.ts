/**
 * 백필 스크립트: 사진으로 찍은 도착 계기판에 `endKmSource: 'ocr'` 소급 표시
 *
 * 배경: 앞 기록이 정정되면 서버 트리거(syncNextLogStartKm)가 뒤 기록의 출발·도착 km를
 *       같은 폭으로 밀어 왔다. 사진으로 확인해 적은 도착 계기판까지 바뀌어 "증빙과 기록이
 *       다른" 상태가 되므로, 이제 `endKmSource: 'ocr'`인 기록은 도착 km를 고정한다.
 *       그 표시는 앞으로 저장되는 기록에만 붙으므로, 이미 쌓인 기록에는 여기서 채운다.
 *
 * 무엇을 근거로 채우나: `inputMethod === 'ocr'`. OCR은 **도착 계기판만** 읽어 채우므로
 * (useDriveLogOcr — endKm·배터리), 그 값이 곧 "도착 km를 사진으로 확인했다"는 뜻이다.
 * 다만 저장 뒤 손으로 고친 경우까지는 구분할 수 없다 — 그래서 **기본은 조회만** 하고,
 * 실제 쓰기는 `--apply`를 붙였을 때만 한다.
 *
 * 사용법:
 *   npx tsx scripts/backfillDriveLogEndKmSource.ts            # 대상만 집계 (기본: 변경 없음)
 *   npx tsx scripts/backfillDriveLogEndKmSource.ts --apply    # 실제 표시
 *   npx tsx scripts/backfillDriveLogEndKmSource.ts --apply --org <기관ID>   # 한 기관만
 *
 * 필요 환경변수:
 *   GOOGLE_APPLICATION_CREDENTIALS — Firebase Admin SDK 서비스 계정 키 경로 (없으면 ADC)
 */
import { getFirestore } from "firebase-admin/firestore";
import { initAdminApp } from "./lib/adminApp";

const isApply = process.argv.includes("--apply");
const orgArgIndex = process.argv.indexOf("--org");
const onlyOrgId = orgArgIndex >= 0 ? process.argv[orgArgIndex + 1] : undefined;

// 자격증명(서비스 계정 키 → ADC)과 **대상 프로젝트 고정**은 lib/adminApp이 맡는다.
const app = initAdminApp();
const db = getFirestore(app);

async function backfill() {
    console.log(`=== 백필 시작: driveLogs.endKmSource ${isApply ? "" : "(조회만 — 쓰려면 --apply)"} ===`);
    if (onlyOrgId) console.log(`대상 기관: ${onlyOrgId}`);
    console.log("");

    // 대상이 되는 문서만 읽는다(전량 조회는 읽기 비용이 기록 수만큼 붙는다).
    let query = db.collection("driveLogs").where("inputMethod", "==", "ocr");
    if (onlyOrgId) query = query.where("organizationId", "==", onlyOrgId);
    const snap = await query.get();

    let marked = 0;
    let alreadyMarked = 0;
    let noEndKm = 0;

    // Firestore 배치 상한(500)을 고려해 청크로 커밋
    let batch = db.batch();
    let batchCount = 0;

    for (const doc of snap.docs) {
        const data = doc.data();

        if (data.endKmSource === "ocr") {
            alreadyMarked++;
            continue;
        }
        // 도착 km가 없으면 고정할 값 자체가 없다
        if (typeof data.endKm !== "number") {
            noEndKm++;
            continue;
        }

        marked++;
        if (!isApply) continue;

        batch.update(doc.ref, { endKmSource: "ocr" });
        batchCount++;

        if (batchCount >= 400) {
            await batch.commit();
            batch = db.batch();
            batchCount = 0;
        }
    }

    if (isApply && batchCount > 0) {
        await batch.commit();
    }

    console.log(`사진(OCR)으로 쓴 운행일지: ${snap.size}개`);
    console.log(`  ${isApply ? "표시함" : "표시 예정"}: ${marked}개`);
    console.log(`  이미 표시 있음(스킵): ${alreadyMarked}개`);
    console.log(`  도착 km 없음(스킵): ${noEndKm}개`);
    if (!isApply && marked > 0) console.log(`\n실제로 표시하려면 --apply를 붙여 다시 실행하세요.`);
    console.log(`\n=== 백필 완료 ===`);
}

backfill().catch((err) => {
    console.error(err);
    process.exit(1);
});
