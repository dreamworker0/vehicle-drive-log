/**
 * 마이그레이션: Slack 봇 토큰을 integrations 문서에 암호화 저장 (멀티테넌트 전환 Phase A)
 *
 * 배경: 파일럿은 전역 시크릿 SLACK_BOT_TOKEN 1개로 동작했다. 멀티테넌트 전환에서
 * 워커(onSlackTaskCreated)는 integrations/slack_{teamId}.tokenCipher를 복호화해
 * 기관별 토큰을 쓴다. 이 스크립트는 기존 파일럿 워크스페이스 문서에 현재 봇 토큰을
 * 암호화(AES-256-GCM)해 tokenCipher로 심는다.
 *
 * ⚠️ 배포 순서(무중단): 이 스크립트를 **새 워커 배포 전에** 실행한다.
 *   - 실행 후: 문서에 tokenCipher가 생기지만, 구 워커는 이 필드를 읽지 않으므로 영향 없음.
 *   - 이후 새 워커가 배포되면 tokenCipher가 이미 있으므로 즉시 정상 동작(무중단).
 *
 * 사용법:
 *   # 시크릿을 로컬 env로 주입 (Secret Manager에서 읽어옴 — 값은 셸에만 머문다)
 *   export SLACK_BOT_TOKEN=$(gcloud secrets versions access latest --secret=SLACK_BOT_TOKEN --project=vehicle-drive-log)
 *   export SLACK_TOKEN_ENC_KEY=$(gcloud secrets versions access latest --secret=SLACK_TOKEN_ENC_KEY --project=vehicle-drive-log)
 *   export GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
 *   npx tsx scripts/migrateSlackToken.ts --dry-run   # 대상만 확인
 *   npx tsx scripts/migrateSlackToken.ts             # 실제 실행
 *
 * 필요 환경변수:
 *   SLACK_BOT_TOKEN                — 현재 봇 토큰(xoxb-) 평문
 *   SLACK_TOKEN_ENC_KEY            — base64 32바이트 마스터 키 (배포 시크릿과 동일)
 *   GOOGLE_APPLICATION_CREDENTIALS — Firebase Admin SDK 서비스 계정 키 경로
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { encryptSecret, decryptSecret } from "../functions/src/core/crypto";

const isDryRun = process.argv.includes("--dry-run");

const botToken = process.env.SLACK_BOT_TOKEN || "";
const encKey = process.env.SLACK_TOKEN_ENC_KEY || "";
if (!botToken || !encKey) {
    console.error("❌ SLACK_BOT_TOKEN / SLACK_TOKEN_ENC_KEY 환경변수가 필요합니다. (Secret Manager에서 export 후 실행)");
    process.exit(1);
}

// 자격증명은 firebase-admin 기본 탐색에 위임한다:
// GOOGLE_APPLICATION_CREDENTIALS(서비스계정 키) → ADC(gcloud auth application-default login) 순.
// 프로젝트는 GOOGLE_CLOUD_PROJECT 환경변수 또는 ADC 기본값을 따른다.
const app = initializeApp();
const db = getFirestore(app);

async function migrate() {
    console.log(`=== Slack 봇 토큰 암호화 마이그레이션 시작 ${isDryRun ? "(DRY-RUN)" : ""} ===\n`);

    const snap = await db.collection("integrations").get();
    console.log(`integrations 컬렉션 전체 문서: ${snap.size}개 → ${snap.docs.map((d) => d.id).join(", ") || "(없음)"}\n`);
    let scanned = 0;
    let migrated = 0;
    let skippedExisting = 0;
    let failed = 0;

    for (const doc of snap.docs) {
        const data = doc.data();
        // Slack 연동 문서는 ID가 slack_{teamId} — getSlackIntegration의 조회 방식과 일치시킨다.
        // (platform 필드는 수동 생성 문서엔 없을 수 있어 ID 접두사로 판별)
        if (!doc.id.startsWith("slack_")) continue;
        scanned++;

        // AAD·getSlackIntegration과 정확히 일치시키기 위해 teamId는 문서 ID 접두사에서 추출
        // (문서 ID = slack_{teamId}, 워커도 slack_${team_id}로 조회)
        const docId = doc.id;
        const teamId = docId.startsWith("slack_") ? docId.slice("slack_".length) : (data.teamId as string) || "";
        if (!teamId) {
            console.error(`❌ ${docId} — teamId를 추출할 수 없어 건너뜀`);
            failed++;
            continue;
        }

        if (data.tokenCipher) {
            console.log(`⏭️  ${docId} — 이미 tokenCipher 존재, 건너뜀`);
            skippedExisting++;
            continue;
        }

        try {
            const aad = `slack_${teamId}`;
            const cipher = encryptSecret(botToken, encKey, aad);
            // 안전장치: 방금 만든 암호문이 같은 키·AAD로 복호화되는지 즉시 검증
            if (decryptSecret(cipher, encKey, aad) !== botToken) {
                throw new Error("복호화 검증 실패 (키/AAD 불일치)");
            }
            if (!isDryRun) {
                await doc.ref.update({ tokenCipher: cipher, updatedAt: new Date() });
            }
            migrated++;
            console.log(`✅ ${docId} (teamId=${teamId}) — tokenCipher 기록`);
        } catch (err) {
            failed++;
            console.error(`❌ ${docId} 처리 실패:`, (err as Error).message);
        }
    }

    console.log(`\n=== 완료 ${isDryRun ? "(DRY-RUN — 실제 변경 없음)" : ""} ===`);
    console.log(`Slack 연동 문서: ${scanned} / 마이그레이션: ${migrated} / 이미 완료: ${skippedExisting} / 실패: ${failed}`);
}

migrate()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("마이그레이션 중단:", err);
        process.exit(1);
    });
