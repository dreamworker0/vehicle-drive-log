/**
 * Firestore 인덱스 빌드 완료 대기 — 배포가 Hosting으로 넘어가기 전에 세우는 게이트.
 *
 * ## 왜 필요한가
 * `firebase deploy --only firestore:indexes`는 인덱스를 **제출만** 하고 빌드 완료를
 * 기다리지 않는다. 그래서 이 게이트가 없던 2026-09-09에 `(organizationId, date, status)`가
 * `CREATING`인 동안 Hosting이 먼저 나갔고, 새 번들을 받은 운전자의 `/employee/today`가
 * **약 5분간 "예약 없음"으로 비어 보였다**(Sentry JAVASCRIPT-REACT-6C — 실제 사용자 1명.
 * 실측: Hosting 완료 11:21 → 인덱스 READY 11:25:52 → 서빙까지 약 10초 더).
 *
 * 같은 계열 사고가 이번이 두 번째다. deploy.yml의 인덱스 스텝 주석이 적어 둔 Phase 139도
 * "화면은 나갔는데 인덱스가 없었다"였고, 그때 **순서**만 고치고 빌드가 비동기라는 절반을
 * 빠뜨렸다. 그래서 문서가 아니라 워크플로가 막는다.
 *
 * ## 판정
 * - `READY`가 아닌 인덱스가 하나라도 있으면 계속 기다린다(`CREATING`·`NEEDS_REPAIR` 포함).
 *   `NEEDS_REPAIR`는 저절로 낫지 않으므로 상한까지 기다린 뒤 실패로 끝나는 것이 맞다 —
 *   사람이 봐야 하는 상태다.
 * - 상한(기본 15분)을 넘기면 **실패**한다. 조용히 넘어가면 위 사고가 반복되고, 그 증상은
 *   배포 직후 현장에서만 드러난다.
 * - **상태를 읽지 못하는 경우도 실패다.** 직전 스텝이 같은 서비스 계정으로 인덱스를
 *   배포했으므로 목록 조회가 안 되는 것은 권한 등 실제 문제이고, 못 읽는 게이트를
 *   통과시키면 없는 것과 같다. 그때는 아래 안내대로 조치한다.
 *
 * ## 사용법
 *   ACCESS_TOKEN=$(gcloud auth print-access-token) npx tsx scripts/wait-for-firestore-indexes.ts
 * 환경변수: ACCESS_TOKEN(필수) · PROJECT_ID(기본 vehicle-drive-log) · WAIT_MINUTES(기본 15)
 *          POLL_SECONDS(기본 15)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Firestore Admin API의 인덱스 목록 응답(필요한 부분만) */
export interface IndexListResponse {
    indexes?: Array<{ name?: string; state?: string; fields?: Array<{ fieldPath?: string }> }>;
    error?: { status?: string; message?: string };
}

/** 빌드가 끝나지 않은 인덱스의 이름 목록. 응답이 오류거나 모양이 다르면 throw 한다. */
export function notReadyIndexes(payload: unknown): string[] {
    if (payload === null || typeof payload !== 'object') {
        throw new Error('인덱스 목록 응답이 객체가 아니다');
    }
    const res = payload as IndexListResponse;
    if (res.error) {
        throw new Error(`인덱스 목록 조회 실패: ${res.error.status ?? '?'} ${res.error.message ?? ''}`.trim());
    }
    // 인덱스가 하나도 없는 컬렉션 그룹은 정상이다(빈 배열도, 키 자체가 없어도).
    if (res.indexes === undefined) return [];
    if (!Array.isArray(res.indexes)) {
        throw new Error('인덱스 목록 응답의 indexes가 배열이 아니다');
    }
    return res.indexes
        .filter((i) => i.state !== 'READY')
        .map((i) => {
            const fields = (i.fields ?? []).map((f) => f.fieldPath).filter(Boolean).join(', ');
            return `${i.state ?? '상태없음'} [${fields}]`;
        });
}

/** firestore.indexes.json에 등장하는 컬렉션 그룹을 중복 없이 뽑는다. */
export function collectionGroupsFrom(config: unknown): string[] {
    const indexes = (config as { indexes?: Array<{ collectionGroup?: string }> })?.indexes;
    if (!Array.isArray(indexes)) throw new Error('firestore.indexes.json의 indexes를 읽지 못했다');
    const groups = new Set<string>();
    for (const i of indexes) if (i.collectionGroup) groups.add(i.collectionGroup);
    if (groups.size === 0) throw new Error('firestore.indexes.json에서 컬렉션 그룹을 하나도 찾지 못했다');
    return [...groups].sort();
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
    const token = process.env.ACCESS_TOKEN;
    if (!token) {
        console.error('❌ ACCESS_TOKEN이 없습니다. gcloud auth print-access-token 결과를 넘기세요.');
        process.exit(1);
    }
    const projectId = process.env.PROJECT_ID || 'vehicle-drive-log';
    const waitMinutes = Number(process.env.WAIT_MINUTES || 15);
    const pollSeconds = Number(process.env.POLL_SECONDS || 15);

    const configPath = path.resolve(__dirname, '..', 'firestore.indexes.json');
    const groups = collectionGroupsFrom(JSON.parse(fs.readFileSync(configPath, 'utf8')));
    console.log(`⏳ 인덱스 빌드 완료 대기 — 컬렉션 그룹 ${groups.length}개, 상한 ${waitMinutes}분`);

    const deadline = Date.now() + waitMinutes * 60_000;
    let round = 0;

    for (;;) {
        round += 1;
        const pending: string[] = [];

        for (const group of groups) {
            const url = `https://firestore.googleapis.com/v1/projects/${projectId}`
                + `/databases/(default)/collectionGroups/${encodeURIComponent(group)}/indexes`;
            let payload: unknown;
            try {
                const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
                payload = await res.json();
            } catch (err) {
                // 네트워크 실패는 게이트가 깨진 것이다 — 통과시키지 않는다.
                console.error(`❌ ${group} 인덱스 목록 요청 실패: ${(err as Error).message}`);
                console.error('   서비스 계정에 datastore.indexes.list 권한이 있는지 확인하세요.');
                process.exit(1);
            }
            try {
                for (const name of notReadyIndexes(payload)) pending.push(`${group} ${name}`);
            } catch (err) {
                console.error(`❌ ${group}: ${(err as Error).message}`);
                console.error('   서비스 계정 권한 또는 API 응답 형식을 확인하세요.');
                console.error('   (긴급 배포가 막히면 이 스텝을 일시적으로 건너뛴 뒤 원인을 고치세요.)');
                process.exit(1);
            }
        }

        if (pending.length === 0) {
            console.log(`✅ 모든 인덱스가 READY입니다 (${round}회 확인).`);
            return;
        }

        if (Date.now() >= deadline) {
            console.error(`❌ ${waitMinutes}분 안에 빌드가 끝나지 않았습니다 — Hosting을 배포하지 않습니다.`);
            for (const p of pending) console.error(`   · ${p}`);
            console.error('   빌드가 끝나면 워크플로를 재실행하세요. NEEDS_REPAIR는 콘솔에서 조치가 필요합니다.');
            process.exit(1);
        }

        console.log(`   빌드 중 ${pending.length}개 — ${pollSeconds}초 후 다시 확인 (${pending[0]}${pending.length > 1 ? ' 외' : ''})`);
        await delay(pollSeconds * 1000);
    }
}

// 테스트에서 import할 때는 실행하지 않는다.
if (process.env.VITEST === undefined) {
    main().catch((err) => {
        console.error('❌ 예상치 못한 오류:', err);
        process.exit(1);
    });
}
