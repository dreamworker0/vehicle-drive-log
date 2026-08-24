/**
 * 정리 스크립트: 익명(Anonymous) 인증 계정을 일괄 삭제한다
 *
 * 배경: 2026-08-24 로그인 제공자 점검에서 **익명 로그인이 켜져 있었다**(감사 리포트
 * 2026-08-23 부록 2의 후속).
 *
 * 앱은 **지금은** 익명 로그인을 호출하지 않는다(`signInAnonymously` 전수 grep 0건). 다만
 * 과거에는 했다 — 기관 신청 폼(`useOrgApplication`)이 증빙서류를 Storage에 올리려고
 * 페이지 진입 시 익명 로그인을 걸었다(2026-03-05 도입 → **2026-04-08 제거**, 지금은 서버가
 * Admin SDK로 업로드하고 `applicantUid: "anonymous-app"`이 그 자리를 대신한다).
 * 그래서 남아 있는 계정은 **그 시기의 잔여물**이거나, 제거 이후에 생긴 것이라면 앱이
 * 만든 것이 아니다(공개 API 키로 발급을 시도한 흔적). 어느 쪽인지는 참조 조회로 가른다
 * — 아래 안전 장치 2번.
 *
 * 제공자를 끈 것으로 **새 발급**은 막혔지만 이미 만들어진 계정은 남는다. 익명 계정은
 * 계정당 상한(작성자별 쿼터·레이트리밋)을 무의미하게 만드는 주체라, 쓰지 않는 것은
 * 치우는 것이 맞다.
 *
 * ## 무엇을 익명으로 판정하는가
 *
 * `providerData`가 비어 있고 email·phoneNumber도 없는 계정. 이 프로젝트의 제공자는
 * Google 하나뿐이므로(익명은 2026-08-24 사용 중지) 정상 사용자는 전원 providerData에
 * google.com을 갖는다. 세 조건을 모두 보는 것은 커스텀 토큰 등 예외를 실수로 지우지
 * 않기 위해서다.
 *
 * ## 안전 장치
 *
 * 1. **기본이 조회다.** 삭제는 `--apply`를 줘야 한다 (선례: clear-invalid-calendar-ids.ts).
 *    계정 삭제는 되돌릴 수 없고, uid를 잃으면 그 uid로 남은 데이터의 주인을 알 수 없다.
 * 2. **어느 문서에서든 참조되는 익명 계정은 건너뛴다.** users 문서·기관 신청·즐겨찾기·
 *    의견·운행일지·예약을 uid로 조회한다. 익명 계정은 아무것도 남기지 못하는 것이
 *    정상이다(joinOrganization이 익명 provider를 거절하고, 나머지 컬렉션은 기관 소속을
 *    요구한다). 참조가 있다면 예상과 다른 상태이므로 코드가 임의로 정하지 않고 목록으로
 *    남긴다 — 확인해야 할 신호다. 확인 후 그래도 지우려면 `--include-referenced`.
 *
 *    이 조회는 "그 계정이 무엇을 했는가"의 증거이기도 하다. 참조가 0건이면 계정만 발급되고
 *    아무 일도 없었다는 뜻이고(외부에서 API 키로 발급을 시도한 흔적), 참조가 있으면 실제
 *    사용자의 클라이언트가 만든 것이다.
 * 3. 대상 프로젝트를 `.firebaserc`로 고정한다. ADC에 프로젝트가 안 딸려 오면 **다른
 *    프로젝트를 조회해 에러 없이 0건**이 나오고, 운영자는 지울 것이 없다고 믿게 된다
 *    (seed-calendar-bindings.ts가 실제로 겪은 함정).
 *
 * 삭제는 Auth의 `onUserDelete` 트리거를 깨운다. 그 트리거는 `users/{uid}`가 있으면
 * 익명화하고 **없으면 NOT_FOUND를 정상 처리해 그냥 넘어간다** — 위 2번을 지키는 한
 * 연쇄 부작용이 없다.
 *
 * 사용법:
 *   npx tsx scripts/delete-anonymous-users.ts                      # 조회만 (기본)
 *   npx tsx scripts/delete-anonymous-users.ts --apply              # 실제 삭제
 *   npx tsx scripts/delete-anonymous-users.ts --apply --include-referenced
 *
 * 필요 환경변수:
 *   GOOGLE_APPLICATION_CREDENTIALS — Firebase Admin SDK 서비스 계정 키 경로
 *   (또는 gcloud ADC. 키 파일은 functions/ 아래와 루트를 함께 본다)
 */
import { initializeApp, cert, type ServiceAccount } from "firebase-admin/app";
import { getAuth, type UserRecord } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync, existsSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const isApply = process.argv.includes("--apply");
const includeReferenced = process.argv.includes("--include-referenced");

// ESM 스코프에는 __dirname이 없다(루트 package.json이 "type": "module").
const scriptDir = dirname(fileURLToPath(import.meta.url));

/** 대상 프로젝트 ID — 환경변수가 없으면 `.firebaserc`의 default (안전 장치 3번) */
function resolveProjectId(): string | undefined {
    const fromEnv = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
    if (fromEnv) return fromEnv;
    try {
        const rc = JSON.parse(readFileSync(resolve(scriptDir, "../.firebaserc"), "utf8"));
        return rc?.projects?.default;
    } catch {
        return undefined;
    }
}

const projectId = resolveProjectId();

/** 서비스 계정 키가 있으면 그것을, 없으면 기본 인증(ADC)을 쓴다 */
function initAdmin() {
    for (const candidate of [
        process.env.GOOGLE_APPLICATION_CREDENTIALS,
        resolve(scriptDir, "../functions/serviceAccountKey.json"),
        resolve(scriptDir, "../serviceAccountKey.json"),
    ]) {
        if (candidate && existsSync(candidate)) {
            const sa = JSON.parse(readFileSync(candidate, "utf-8")) as ServiceAccount;
            return initializeApp({ credential: cert(sa), ...(projectId ? { projectId } : {}) });
        }
    }
    return initializeApp(projectId ? { projectId } : undefined);
}

const app = initAdmin();
const auth = getAuth(app);
const db = getFirestore(app);

/**
 * 익명 계정 판정.
 *
 * providerData만 보지 않는 이유는 주석 상단에 있다 — 세 조건을 모두 만족할 때만 익명으로
 * 본다. 지나치게 좁아 몇 개를 남기는 것이 정상 계정 하나를 지우는 것보다 낫다.
 */
function isAnonymous(user: UserRecord): boolean {
    return user.providerData.length === 0 && !user.email && !user.phoneNumber;
}

/**
 * 이 uid를 참조하는 문서를 찾는다 (컬렉션·필드 → 찾은 건수).
 *
 * 필드명은 각 스키마의 것이다(src/schemas/) — 이름이 어긋나면 조용히 0건이 나와
 * "아무것도 안 했다"로 오판하게 되므로, 스키마를 바꿀 때 이 목록도 함께 본다.
 */
const UID_FIELDS: { collection: string; field: string }[] = [
    { collection: "organizations", field: "applicantUid" },
    { collection: "favorites", field: "userId" },
    { collection: "feedbacks", field: "authorUid" },
    { collection: "driveLogs", field: "driverUid" },
    { collection: "driveLogs", field: "createdByUid" },
    { collection: "reservations", field: "reservedByUid" },
];

async function findReferences(uid: string): Promise<string[]> {
    const hits: string[] = [];

    const userDoc = await db.collection("users").doc(uid).get();
    if (userDoc.exists) hits.push("users 문서");

    for (const { collection, field } of UID_FIELDS) {
        const snap = await db.collection(collection).where(field, "==", uid).limit(1).get();
        if (!snap.empty) hits.push(`${collection}.${field}`);
    }
    return hits;
}

async function run() {
    console.log(`=== 익명 계정 정리 ${isApply ? "(삭제 실행)" : "(조회 — 삭제하지 않음)"} ===\n`);
    console.log(`대상 프로젝트: ${projectId ?? "(미지정 — ADC 기본값을 씁니다)"}`);
    if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
        console.log("⚠️  에뮬레이터 접속 중 — 프로덕션이 아닙니다");
    }
    console.log("");

    // 전체 계정을 훑는다. listUsers는 한 페이지 최대 1000건.
    const anonymous: UserRecord[] = [];
    let total = 0;
    let pageToken: string | undefined;
    do {
        const page = await auth.listUsers(1000, pageToken);
        total += page.users.length;
        anonymous.push(...page.users.filter(isAnonymous));
        pageToken = page.pageToken;
    } while (pageToken);

    console.log(`전체 계정 ${total}개 중 익명 ${anonymous.length}개\n`);

    if (anonymous.length === 0) {
        console.log("✅ 익명 계정이 없습니다. 할 일이 없습니다.");
        return;
    }

    // 참조가 있는 익명 계정은 예상과 다른 상태다 (안전 장치 2번)
    const referenced = new Map<string, string[]>();
    for (const u of anonymous) {
        const hits = await findReferences(u.uid);
        if (hits.length > 0) referenced.set(u.uid, hits);
    }
    const targets = includeReferenced ? anonymous : anonymous.filter(u => !referenced.has(u.uid));

    for (const u of anonymous) {
        const hits = referenced.get(u.uid);
        const mark = hits
            ? (includeReferenced ? `삭제(참조 있음·강제: ${hits.join(", ")})` : `건너뜀(참조: ${hits.join(", ")})`)
            : "삭제 대상 (참조 0건 — 아무것도 남기지 않았다)";
        console.log(`  ${u.uid}`);
        console.log(`    생성 ${u.metadata.creationTime}`);
        console.log(`    최근 로그인 ${u.metadata.lastSignInTime || "-"}`);
        console.log(`    → ${mark}`);
    }
    console.log("");

    if (referenced.size > 0) {
        console.log(`⚠️  참조가 있는 익명 계정 ${referenced.size}개 — 익명 계정은 아무것도 남기지 못하는 것이 정상이다.`);
        console.log("    무엇이 만들었는지 확인한 뒤에 지울 것. 확인했다면 --include-referenced.\n");
    }

    if (!isApply) {
        console.log(`조회만 했다. 삭제하려면 --apply (대상 ${targets.length}개)`);
        console.log("실행 전 확인: Authentication → 로그인 방법에서 '익명'이 사용 중지 상태여야 한다.");
        console.log("            켜져 있으면 지워도 같은 방식으로 다시 만들어진다.");
        return;
    }

    if (targets.length === 0) {
        console.log("삭제할 대상이 없다(모두 건너뜀).");
        return;
    }

    // deleteUsers는 한 번에 최대 1000개. 개별 실패는 예외가 아니라 결과에 담겨 온다.
    let deleted = 0;
    const failures: { uid: string; reason: string }[] = [];
    for (let i = 0; i < targets.length; i += 1000) {
        const chunk = targets.slice(i, i + 1000);
        const result = await auth.deleteUsers(chunk.map(u => u.uid));
        deleted += result.successCount;
        for (const err of result.errors) {
            failures.push({ uid: chunk[err.index].uid, reason: err.error.message });
        }
    }

    console.log(`✅ 삭제 ${deleted}개 / 실패 ${failures.length}개`);
    for (const f of failures) console.log(`  ✗ ${f.uid} — ${f.reason}`);
    if (failures.length > 0) process.exitCode = 1;
}

run().catch(err => {
    console.error("실행 실패:", err);
    process.exit(1);
});
