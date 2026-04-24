/**
 * normalizeVehicleModelNames — 차량 모델명 정규화 마이그레이션
 *
 * Firestore `vehicles` 컬렉션의 modelName 필드를
 * VEHICLE_MODEL_SUGGESTIONS 표준 목록 기준으로 일괄 정규화합니다.
 *
 * 사용법:
 *   # 1단계: dry-run (실제 쓰기 없음 — 변경 예정 목록만 출력)
 *   cd functions && npx tsx ../scripts/normalizeVehicleModelNames.ts
 *
 *   # 2단계: 실제 적용
 *   cd functions && npx tsx ../scripts/normalizeVehicleModelNames.ts --apply
 *
 * 서비스 계정:
 *   - functions/serviceAccountKey.json 이 있으면 자동 사용
 *   - 없으면 GOOGLE_APPLICATION_CREDENTIALS 환경변수 또는 gcloud 기본 인증 사용
 */
import { initializeApp, cert, type ServiceAccount } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─────────────────────────────────────────────────────────────
// 표준 차량 모델명 목록 (useVehicleManager.ts 의 VEHICLE_MODEL_SUGGESTIONS 와 동기화)
// ─────────────────────────────────────────────────────────────
const STANDARD_MODELS: string[] = [
    // 현대 — 승용/SUV
    '아반떼', '소나타', '그랜저', '아이오닉', '아이오닉5', '아이오닉6', '코나', '투싼', '싼타페', '팰리세이드',
    '엑센트', '클릭', '베뉴', '캐스퍼',
    // 현대 — 상용/승합/버스
    '스타리아', '스타렉스', '그랜드 스타렉스', '포터', '마이티', '카운티', '솔라티', '에어로타운', '유니버스',
    // 기아 — 승용/SUV
    'K3', 'K5', 'K8', 'K9', '레이', '모닝', '스포티지', '쏘렌토', '카니발', '그랜드 카니발', '텔루라이드',
    '셀토스', '니로', '쏘울', '프라이드', '로체',
    // 기아 — 전기
    'EV3', 'EV5', 'EV6', 'EV9', 'PV5',
    // 기아 — 상용
    '봉고3',
    // 제네시스
    'G70', 'G80', 'G90', 'GV70', 'GV80',
    // KG모빌리티(구 쌍용)
    '티볼리', '코란도', '렉스턴', '무쏘', '토레스',
    // 르노코리아
    'SM6', 'SM7', 'QM6', '클리오', 'XM3',
    // 쉐보레/GM대우
    '스파크', '말리부', '트랙스', '트레일블레이저', '이쿼녹스', '마티즈', '볼트EV',
    // 도요타
    '캠리',
    // 버스
    'BH090', 'CEVO-C',
    // 수소·전기 전용
    '넥쏘',
];

// ─────────────────────────────────────────────────────────────
// 별칭 맵: 비표준명 → 표준명 명시 변환
// ─────────────────────────────────────────────────────────────
const ALIAS_MAP: Record<string, string> = {
    // 포터 계열 통합
    '포터2':             '포터',
    '포터Ⅱ':           '포터',
    '1톤 포터':        '포터',
    // 스타렉스 계열
    '그랜드스타렉스': '그랜드 스타렉스',
    '뉴스타렉스':     '스타렉스',
    '구스타렉스':     '스타렉스',
    // 카운티 계열
    '뉴카운티':        '카운티',
    '이-카운티':       '카운티',
    // 단종 모델 정규화
    '넥소':             '넥쏘',
    '뉴마티즈':        '마티즈',
    '뉴아반떼':        '아반떼',
    '뉴아반테':        '아반떼',
    // 솔라티 계열
    '솔라디':           '솔라티',
    '쏠라티':           '솔라티',
    // 스타랙스 (오타)
    '스타랙스':         '스타렉스',
    // 오타
    '네이':             '레이',
    // 전기차
    '볼트 EV':         '볼트EV',
    '쉐보레 볼트 EV':  '볼트EV',
    '볼트EUV':          '볼트EV',
    // EV5 계열
    'EV5론지레인지어스': 'EV5',
    // PV5 계열
    'PV5 카고 롱레인지': 'PV5',
    // 에어로타운
    '이에어로타운':   '에어로타운',
};


// ─────────────────────────────────────────────────────────────
// Firebase Admin 초기화
// ─────────────────────────────────────────────────────────────
const saPath = resolve(__dirname, "../functions/serviceAccountKey.json");
if (existsSync(saPath)) {
    const sa = JSON.parse(readFileSync(saPath, "utf-8")) as ServiceAccount;
    initializeApp({ credential: cert(sa) });
} else {
    initializeApp();
}

const db = getFirestore();
const IS_DRY_RUN = !process.argv.includes("--apply");

// ─────────────────────────────────────────────────────────────
// 정규화 로직
// ─────────────────────────────────────────────────────────────

/**
 * 입력값을 표준 모델명으로 변환한다.
 * 1. trim 후 빈 값이면 null 반환
 * 2. 정확히 일치하면 그대로 반환 (변경 없음)
 * 3. 대소문자·앞뒤 공백 무시 비교로 일치하면 표준명 반환
 * 4. 표준명을 포함(contains)하는 경우 해당 표준명 반환
 * 5. 매핑 불가 → trim된 원본 값 + 'UNMAPPED' 마킹
 */
function normalize(raw: string): { next: string; matched: boolean; exact: boolean } {
    const trimmed = raw.trim();
    if (!trimmed) return { next: trimmed, matched: false, exact: true };

    const lc = trimmed.toLowerCase();

    // 1) 완전 일치 (이미 표준)
    const exactMatch = STANDARD_MODELS.find(m => m === trimmed);
    if (exactMatch) return { next: exactMatch, matched: true, exact: true };

    // 2) 대소문자·공백 무시 일치
    const caseMatch = STANDARD_MODELS.find(m => m.toLowerCase() === lc);
    if (caseMatch) return { next: caseMatch, matched: true, exact: false };

    // 3) ALIAS_MAP: 키가 입력값에 포함되는지 — 가장 긴 키 우선
    const aliasKey = Object.keys(ALIAS_MAP)
        .filter(k => lc.includes(k.toLowerCase()))
        .sort((a, b) => b.length - a.length)[0];
    if (aliasKey) return { next: ALIAS_MAP[aliasKey], matched: true, exact: false };

    // 4) contains: 표준명이 입력값에 포함 — 가장 긴 표준명 우선
    const containedBy = STANDARD_MODELS
        .filter(m => lc.includes(m.toLowerCase()))
        .sort((a, b) => b.length - a.length)[0];
    if (containedBy) return { next: containedBy, matched: true, exact: false };

    // 5) 매핑 불가 — trim만 적용
    return { next: trimmed, matched: false, exact: false };
}

// ─────────────────────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────────────────────
async function migrate() {
    console.log("🚗 차량 모델명 정규화 마이그레이션 시작");
    console.log(`   모드: ${IS_DRY_RUN ? "🔍 DRY-RUN (읽기 전용)" : "✏️  APPLY (실제 쓰기)"}`);
    console.log(`   표준 모델 수: ${STANDARD_MODELS.length}개\n`);

    const snapshot = await db.collection("vehicles").get();
    console.log(`📦 총 vehicles 문서 수: ${snapshot.size}개\n`);

    const BATCH_SIZE = 500;
    let batch = db.batch();
    let batchCount = 0;

    let totalSkipped = 0;    // 변경 불필요 (이미 표준 or 빈 값)
    let totalChanged = 0;    // 실제 변경 대상
    let totalUnmapped = 0;   // 매핑 불가 (trim만 적용)

    const unmappedList: string[] = [];

    for (const doc of snapshot.docs) {
        const data = doc.data();
        const rawModelName: string | undefined = data.modelName;

        // modelName 필드가 없거나 빈 값이면 스킵
        if (!rawModelName || rawModelName.trim() === "") {
            console.log(`  ⏭  [SKIP]    ${doc.id} — modelName 없음`);
            totalSkipped++;
            continue;
        }

        const { next, matched, exact } = normalize(rawModelName);

        // 이미 표준명이고 변경 없는 경우 스킵
        if (exact && matched) {
            console.log(`  ✅ [OK]      ${doc.id} — "${rawModelName}" (이미 표준)`);
            totalSkipped++;
            continue;
        }

        // trim만 해도 원본과 동일한 경우 (매핑 불가 + trim 변경 없음)
        if (!matched && next === rawModelName) {
            const orgId: string = data.organizationId ?? "?";
            console.log(`  ⚠️  [UNMAPPED] ${doc.id} (org: ${orgId}) — "${rawModelName}" → 매핑 불가`);
            unmappedList.push(`  - [${orgId}] "${rawModelName}"`);
            totalUnmapped++;
            totalSkipped++;
            continue;
        }

        // 변경 대상
        const tag = matched ? "[NORMALIZE]" : "[TRIM]     ";
        console.log(`  🔄 ${tag} ${doc.id} — "${rawModelName}" → "${next}"`);
        totalChanged++;

        if (!IS_DRY_RUN) {
            batch.update(doc.ref, { modelName: next });
            batchCount++;

            if (batchCount >= BATCH_SIZE) {
                await batch.commit();
                console.log(`\n  💾 배치 커밋 (${batchCount}건)\n`);
                batch = db.batch();
                batchCount = 0;
            }
        }
    }

    // 남은 배치 커밋
    if (!IS_DRY_RUN && batchCount > 0) {
        await batch.commit();
        console.log(`\n  💾 최종 배치 커밋 (${batchCount}건)\n`);
    }

    // ── 요약 ──
    console.log("\n" + "─".repeat(60));
    console.log("📊 마이그레이션 요약");
    console.log(`   전체 문서  : ${snapshot.size}개`);
    console.log(`   변경 대상  : ${totalChanged}개`);
    console.log(`   스킵 (정상): ${totalSkipped}개`);
    console.log(`   매핑 불가  : ${totalUnmapped}개`);

    if (unmappedList.length > 0) {
        console.log("\n⚠️  매핑 불가 목록 (수동 검토 필요):");
        unmappedList.forEach(l => console.log(l));
    }

    if (IS_DRY_RUN) {
        console.log("\n🔍 DRY-RUN 완료 — 실제 변경은 없었습니다.");
        if (totalChanged > 0) {
            console.log("   실제 적용하려면 --apply 플래그를 추가하세요:");
            console.log("   cd functions && npx tsx ../scripts/normalizeVehicleModelNames.ts --apply");
        }
    } else {
        console.log(`\n✅ 마이그레이션 완료! (${totalChanged}개 문서 업데이트)`);
    }
}

migrate().catch(err => {
    console.error("❌ 마이그레이션 실패:", err);
    process.exit(1);
});
