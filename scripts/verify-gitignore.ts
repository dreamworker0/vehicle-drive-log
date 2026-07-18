/**
 * .gitignore 자동 검증 — 민감 환경변수/시크릿 파일이 무시되고, 예시/에뮬레이터 설정은
 * 추적되는지 확인한다. 하나라도 어긋나면 exit 1 (fail-closed).
 *
 * (2026-07-18 보안 재점검 F — .env.production/.development/.test, functions/.env.<project>,
 *  .runtimeconfig.json 등이 무시되지 않던 갭에 대한 회귀 가드)
 *
 * 실행: npm run verify:gitignore  (또는 npx tsx scripts/verify-gitignore.ts)
 * git check-ignore: 무시되면 exit 0, 아니면 exit 1 (파일 실재 여부와 무관하게 규칙만 평가).
 */
import { execFileSync } from "child_process";

// git 실행 불가/비-저장소 환경에서 모든 검사가 잘못 실패하지 않도록 사전 확인한다.
try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { stdio: "ignore" });
} catch {
    console.error("❌ Git 저장소가 아니거나 git을 실행할 수 없습니다.");
    process.exit(1);
}

/** 반드시 무시되어야 하는 파일 (커밋 시 시크릿 유출 위험) */
const MUST_IGNORE = [
    ".env",
    ".env.local",
    ".env.production",
    ".env.development",
    ".env.test",
    ".env.vehicle-drive-log",
    "functions/.env",
    "functions/.env.vehicle-drive-log",
    ".runtimeconfig.json",
    "serviceAccountKey.json",
];

/** 반드시 추적되어야 하는 파일 (예시/에뮬레이터 설정 — 시크릿 아님) */
const MUST_TRACK = [
    ".env.example",
    ".env.local.example",
    ".env.emulator",
    "functions/.env.example",
];

function isIgnored(relPath: string): boolean {
    try {
        // --no-index: 인덱스(추적) 상태와 무관하게 .gitignore 규칙 자체만 평가한다.
        // (추적 중인 파일도 규칙 매치 여부를 정확히 검사하기 위함)
        execFileSync("git", ["check-ignore", "-q", "--no-index", "--", relPath], { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

let failed = false;

for (const p of MUST_IGNORE) {
    if (!isIgnored(p)) {
        console.error(`❌ 무시되어야 하는데 추적 대상임: ${p}`);
        failed = true;
    }
}
for (const p of MUST_TRACK) {
    if (isIgnored(p)) {
        console.error(`❌ 추적되어야 하는데 무시됨: ${p}`);
        failed = true;
    }
}

if (failed) {
    console.error("\n.gitignore 검증 실패 — 위 항목을 확인하세요.");
    process.exit(1);
}
console.log(`✅ .gitignore 검증 통과 (차단 ${MUST_IGNORE.length}건 / 허용 ${MUST_TRACK.length}건)`);
