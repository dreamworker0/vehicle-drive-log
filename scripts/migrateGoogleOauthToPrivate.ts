/**
 * 기존 users/{uid} 문서의 googleOauth 필드를
 * users/{uid}/private/oauth 서브컬렉션(Cloud Functions/Admin SDK 전용)으로 이전한다.
 *
 * 배경: 과거 googleOauth(access/refresh 토큰)는 users 문서에 저장돼 같은 기관 멤버
 * 누구나 Firestore 규칙상 읽을 수 있었다(2026-07-10 감사 #4). 규칙을 서브컬렉션
 * Functions 전용으로 잠근 뒤, 남아 있는 토큰을 안전한 위치로 옮기고 원본 필드를 제거한다.
 *
 * 사용법:
 *   cd functions && npx tsx ../scripts/migrateGoogleOauthToPrivate.ts [--dry-run|--verify-only]
 *   - (플래그 없음) execute:     이동 실행. failed>0 이면 종료 코드 1.
 *   - --dry-run:                 쓰기 없이 이동 대상(movable)만 집계.
 *   - --verify-only:             잔존 googleOauth.refreshToken 수(remaining) 집계. 1건 이상이면 종료 코드 1.
 *
 * 멱등(idempotent): 이미 이전된 문서는 필드가 없으므로 자동 스킵된다.
 */
import { initializeApp, cert, type ServiceAccount } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readFileSync, existsSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { parseMigrationMode, shouldMoveOauth, type MigrationMode } from "./lib/googleOauthMigration";

// ESM 스코프에는 __dirname이 없다(루트 package.json이 "type": "module").
// 스크립트 파일 위치 기준으로 경로를 계산한다.
const scriptDir = dirname(fileURLToPath(import.meta.url));

// Firebase Admin 초기화 (서비스 계정 키 파일 또는 기본 인증)
const saPath = resolve(scriptDir, "../functions/serviceAccountKey.json");
if (existsSync(saPath)) {
    const sa = JSON.parse(readFileSync(saPath, "utf-8")) as ServiceAccount;
    initializeApp({ credential: cert(sa) });
} else {
    // GOOGLE_APPLICATION_CREDENTIALS 환경변수 또는 gcloud 기본 인증 사용
    initializeApp();
}

const db = getFirestore();

interface MigrationResult {
    scanned: number;
    movable: number;
    moved: number;
    skipped: number;
    failed: number;
    remaining: number;
}

async function migrate(mode: MigrationMode): Promise<MigrationResult> {
    const label =
        mode === "dry-run" ? " (dry-run: 쓰기 없음)" : mode === "verify-only" ? " (verify-only: 검증만)" : "";
    console.log(`🔄 googleOauth → private/oauth 서브컬렉션 이전 시작${label}...\n`);

    const usersSnap = await db.collection("users").get();
    console.log(`총 ${usersSnap.size}명의 사용자 확인\n`);

    const result: MigrationResult = {
        scanned: usersSnap.size,
        movable: 0,
        moved: 0,
        skipped: 0,
        failed: 0,
        remaining: 0,
    };

    for (const userDoc of usersSnap.docs) {
        const uid = userDoc.id;
        const oauth = userDoc.data().googleOauth;

        if (!shouldMoveOauth(oauth)) {
            result.skipped++;
            continue;
        }

        result.movable++;

        // 검증 전용 모드: 잔존 토큰만 집계하고 쓰기하지 않는다.
        if (mode === "verify-only") {
            result.remaining++;
            console.log(`  ⚠️  ${uid} — googleOauth.refreshToken 잔존`);
            continue;
        }

        // dry-run: 쓰기 없이 이동 대상만 보고한다.
        if (mode === "dry-run") {
            console.log(`  🔎 ${uid} — 이동 대상`);
            continue;
        }

        try {
            // 1. 서브컬렉션에 토큰 저장
            await db.collection("users").doc(uid).collection("private").doc("oauth").set(oauth, { merge: true });
            // 2. 원본 문서에서 googleOauth 필드 제거
            await userDoc.ref.update({ googleOauth: FieldValue.delete() });
            console.log(`  ✅ ${uid} — 토큰 이전 + 원본 필드 제거`);
            result.moved++;
        } catch (err: unknown) {
            console.error(`  ❌ ${uid} — 실패:`, (err as Error).message);
            result.failed++;
        }
    }

    console.log(
        `\n📊 결과: 확인=${result.scanned}, 이동대상=${result.movable}, 이전=${result.moved}, ` +
            `스킵(토큰없음)=${result.skipped}, 실패=${result.failed}, 잔존=${result.remaining}`,
    );

    return result;
}

const mode = parseMigrationMode(process.argv.slice(2));

migrate(mode)
    .then((result) => {
        // 실패 계약: 이전 실패가 있거나(execute), 잔존 토큰이 있으면(verify-only) 종료 코드 1.
        if (result.failed > 0 || result.remaining > 0) {
            console.error("\n⚠️  실패 또는 잔존 토큰이 있어 종료 코드 1로 종료합니다.");
            process.exitCode = 1;
        } else {
            console.log("\n✅ 마이그레이션 완료!");
        }
    })
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
