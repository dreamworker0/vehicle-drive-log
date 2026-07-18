/**
 * 마이그레이션: 기관 증빙서류의 영구 다운로드 토큰 제거 + 경로 백필
 *
 * 배경(2026-07-18 보안 재검증 P0-3): submitOrgApplication이 증빙서류에 만료 없는
 * firebaseStorageDownloadTokens를 심고 그 URL(uniqueNumberImageUrl)을 Firestore에 저장해왔다.
 * 토큰 URL은 Storage 규칙을 우회하는 bearer capability라 민감서류(사업자등록증 등)가
 * 유출되면 무인증 다운로드가 가능하다. 이 스크립트는 기존 문서에 대해:
 *   1) Storage 파일의 다운로드 토큰을 무효화(빈 값으로 덮어쓰기)한다.
 *   2) uniqueNumberImagePath(경로)를 백필한다.
 *   3) 레거시 uniqueNumberImageUrl(토큰 URL)을 제거한다.
 * 이후 표시는 getOrgDocumentUrl 콜러블의 단기 서명 URL로만 이뤄진다.
 *
 * 사용법:
 *   npx tsx scripts/migrateOrgDocTokens.ts            # 실제 실행
 *   npx tsx scripts/migrateOrgDocTokens.ts --dry-run  # 변경 없이 대상만 집계
 *
 * 필요 환경변수:
 *   GOOGLE_APPLICATION_CREDENTIALS — Firebase Admin SDK 서비스 계정 키 경로
 *   FIREBASE_STORAGE_BUCKET        — (선택) 기본값 `${projectId}.firebasestorage.app`
 */
import { initializeApp, cert, ServiceAccount } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import * as path from "path";
import * as fs from "fs";

const isDryRun = process.argv.includes("--dry-run");

const keyPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.resolve(__dirname, "../serviceAccountKey.json");

let projectId: string | undefined;
let app;
try {
    const serviceAccountStr = fs.readFileSync(keyPath, "utf-8");
    const rawServiceAccount = JSON.parse(serviceAccountStr) as Record<string, string>;
    // 서비스계정 키 JSON은 snake_case(project_id)다. cert()는 양쪽을 받지만
    // 버킷 조합용 projectId는 실제 필드명으로 읽어야 한다(projectId만 읽으면 undefined).
    projectId = rawServiceAccount.project_id || rawServiceAccount.projectId;
    app = initializeApp({
        credential: cert(rawServiceAccount as ServiceAccount),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`,
    });
} catch {
    app = initializeApp();
}

if (!projectId && !process.env.FIREBASE_STORAGE_BUCKET) {
    console.error("❌ 서비스계정에서 project_id를 읽지 못했습니다. GOOGLE_APPLICATION_CREDENTIALS 또는 FIREBASE_STORAGE_BUCKET를 확인하세요.");
    process.exit(1);
}

const db = getFirestore(app);
const bucket = getStorage(app).bucket();

/** 레거시 토큰 URL에서 Storage 경로를 역추출한다. */
function pathFromUrl(url: string): string | null {
    // 쿼리스트링/프래그먼트 전까지 매칭 — 쿼리 파라미터가 없어도 견고하게 동작한다.
    const match = url.match(/\/o\/([^?#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
}

async function migrate() {
    console.log(`=== 증빙서류 토큰 제거 마이그레이션 시작 ${isDryRun ? "(DRY-RUN)" : ""} ===\n`);

    const snap = await db.collection("organizations").get();
    let scanned = 0;
    let migrated = 0;
    let tokenRevoked = 0;
    let skippedNoFile = 0;
    let failed = 0;

    for (const doc of snap.docs) {
        const data = doc.data();
        const legacyUrl = (data.uniqueNumberImageUrl as string) || "";
        const existingPath = (data.uniqueNumberImagePath as string) || "";

        // 이미 경로 기반이거나 이미지가 없으면 대상 아님
        if (!legacyUrl && !existingPath) continue;
        if (!legacyUrl) continue; // 이미 신규 방식(경로만 존재)

        scanned++;
        const orgId = doc.id;
        const derivedPath = existingPath || pathFromUrl(legacyUrl);
        // 경로를 얻지 못하면(URL 파싱 실패) 문서를 건드리지 않고 건너뛴다.
        // 여기서 uniqueNumberImageUrl을 비우면 증빙 참조가 영구 유실되므로 수동 확인 대상으로 남긴다.
        if (!derivedPath) {
            console.error(`❌ 경로 추출 실패 (${orgId}) — 마이그레이션 건너뜀 (수동 확인 필요, 문서 미변경)`);
            failed++;
            continue;
        }

        try {
            // 1) Storage 파일 토큰 무효화 (파일이 존재할 때만)
            const file = bucket.file(derivedPath);
            const [exists] = await file.exists();
            if (exists) {
                if (!isDryRun) {
                    await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: "" } });
                }
                tokenRevoked++;
            } else {
                skippedNoFile++;
            }

            // 2) Firestore 필드 갱신 — 경로 백필 + 레거시 URL 제거
            if (!isDryRun) {
                await doc.ref.update({ uniqueNumberImagePath: derivedPath, uniqueNumberImageUrl: "" });
            }
            migrated++;
            console.log(`✅ ${orgId} → ${derivedPath}`);
        } catch (err) {
            failed++;
            console.error(`❌ ${orgId} 처리 실패:`, (err as Error).message);
        }
    }

    console.log(`\n=== 완료 ${isDryRun ? "(DRY-RUN — 실제 변경 없음)" : ""} ===`);
    console.log(`대상(레거시 URL 보유): ${scanned}`);
    console.log(`마이그레이션: ${migrated} / 토큰 무효화: ${tokenRevoked} / 파일 없음: ${skippedNoFile} / 실패: ${failed}`);
}

migrate()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("마이그레이션 중단:", err);
        process.exit(1);
    });
