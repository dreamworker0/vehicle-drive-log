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
 *
 * ⚠️ 이 근거는 신규 기록만큼 정확하지 않다. `inputMethod`는 "사진을 썼다"까지만 말하고,
 * 인식값을 사람이 고쳐 쓴 경우에도 그대로 `'ocr'`이다(useDriveLogOcr는 손으로 고쳐도
 * ocrSuccess를 되돌리지 않는다). 신규 기록은 인식값과 저장값이 같을 때만 표시를 붙이지만
 * 여기서는 그 비교를 할 수 없다. 그래서
 *   - 기본은 **조회만** 한다(쓰려면 `--apply`),
 *   - `--apply`는 **기관을 지정해야** 한다(`--org`) — 전 기관 일괄은 받지 않는다,
 *   - 잘못 붙은 표시는 `--undo`로 되돌린다.
 * 기관 담당자에게 "사진을 찍고 숫자를 고쳐 쓰신 적이 있는지" 확인한 뒤 기관별로 돌린다.
 *
 * 사용법:
 *   npx tsx scripts/backfillDriveLogEndKmSource.ts                        # 전체 대상 집계 (변경 없음)
 *   npx tsx scripts/backfillDriveLogEndKmSource.ts --org <기관ID>          # 한 기관 집계
 *   npx tsx scripts/backfillDriveLogEndKmSource.ts --org <기관ID> --apply  # 실제 표시
 *   npx tsx scripts/backfillDriveLogEndKmSource.ts --org <기관ID> --undo   # 표시 되돌리기
 *
 * 필요 환경변수:
 *   GOOGLE_APPLICATION_CREDENTIALS — Firebase Admin SDK 서비스 계정 키 경로 (없으면 ADC)
 */
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { initAdminApp } from "./lib/adminApp";

const isApply = process.argv.includes("--apply");
const isUndo = process.argv.includes("--undo");
const orgArgIndex = process.argv.indexOf("--org");
const onlyOrgId = orgArgIndex >= 0 ? process.argv[orgArgIndex + 1] : undefined;

// 쓰기는 기관을 지정해야만 한다 — 근거가 완전하지 않은 표시를 200여 기관에 한 번에 붙이지 않는다.
if ((isApply || isUndo) && !onlyOrgId) {
    console.error("❌ --apply/--undo는 --org <기관ID>와 함께 써야 합니다 (전 기관 일괄 실행은 받지 않습니다).");
    process.exit(1);
}

// 자격증명(서비스 계정 키 → ADC)과 **대상 프로젝트 고정**은 lib/adminApp이 맡는다.
const app = initAdminApp();
const db = getFirestore(app);

async function backfill() {
    const mode = isUndo ? "되돌리기" : isApply ? "표시" : "조회만 — 쓰려면 --org와 --apply";
    console.log(`=== 백필 시작: driveLogs.endKmSource (${mode}) ===`);
    if (onlyOrgId) console.log(`대상 기관: ${onlyOrgId}`);
    console.log("");

    // 대상이 되는 문서만 읽는다(전량 조회는 읽기 비용이 기록 수만큼 붙는다).
    let query = db.collection("driveLogs").where("inputMethod", "==", "ocr");
    if (onlyOrgId) query = query.where("organizationId", "==", onlyOrgId);
    const snap = await query.get();

    let marked = 0;
    let alreadyMarked = 0;
    let noEndKm = 0;
    let cleared = 0;

    // Firestore 배치 상한(500)을 고려해 청크로 커밋
    let batch = db.batch();
    let batchCount = 0;

    for (const doc of snap.docs) {
        const data = doc.data();

        if (isUndo) {
            if (data.endKmSource !== "ocr") continue;
            cleared++;
            batch.update(doc.ref, { endKmSource: FieldValue.delete() });
            batchCount++;
            if (batchCount >= 400) {
                await batch.commit();
                batch = db.batch();
                batchCount = 0;
            }
            continue;
        }

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

    if ((isApply || isUndo) && batchCount > 0) {
        await batch.commit();
    }

    console.log(`사진(OCR)으로 쓴 운행일지: ${snap.size}개`);
    if (isUndo) {
        console.log(`  표시 지움: ${cleared}개`);
    } else {
        console.log(`  ${isApply ? "표시함" : "표시 예정"}: ${marked}개`);
        console.log(`  이미 표시 있음(스킵): ${alreadyMarked}개`);
        console.log(`  도착 km 없음(스킵): ${noEndKm}개`);
        if (!isApply && marked > 0) {
            console.log(`\n실제로 표시하려면 --org <기관ID> --apply로 다시 실행하세요.`);
            console.log(`잘못 붙였다면 --org <기관ID> --undo로 되돌릴 수 있습니다.`);
        }
    }
    console.log(`\n=== 백필 완료 ===`);
}

backfill().catch((err) => {
    console.error(err);
    process.exit(1);
});
