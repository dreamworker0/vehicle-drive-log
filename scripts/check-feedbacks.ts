#!/usr/bin/env node
/**
 * check-feedbacks.js — 피드백 데이터 조회 스크립트
 *
 * Firebase Admin SDK를 이용하여 feedbacks 컬렉션에서
 * 최근 피드백을 조회하고 타입별/상태별 요약을 출력합니다.
 *
 * 사용법:
 *   npx tsx scripts/check-feedbacks.ts [--limit=30]
 *   npx tsx scripts/check-feedbacks.ts --search=신청           # 본문에 이 낱말이 든 것만
 *   npx tsx scripts/check-feedbacks.ts --since=2026-07-01      # 이 날짜 이후만
 *   npx tsx scripts/check-feedbacks.ts --search=신청 --full    # 본문을 자르지 않고 전체
 *
 * `--search`·`--since`를 두는 이유: 기본 출력은 최근 것을 통째로 쏟아내므로, 특정 증상을
 * 확인하려면 관계없는 문의의 개인정보까지 화면에 남는다. 조사 목적이 정해져 있을 때는
 * 필요한 범위만 뽑는다. 키워드는 Firestore가 부분 문자열을 검색하지 못하므로 받아온 뒤
 * 메모리에서 거른다(이 컬렉션은 이미 전량을 읽어 통계를 낸다).
 *
 * 환경:
 *   GOOGLE_APPLICATION_CREDENTIALS 환경변수에 서비스 계정 키 경로 필요
 *   또는 Firebase CLI로 인증된 상태여야 합니다.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

// --- 설정 ---
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '30', 10);
const SEARCH = process.argv.find(a => a.startsWith('--search='))?.split('=')[1] || '';
const SINCE = process.argv.find(a => a.startsWith('--since='))?.split('=')[1] || '';
const FULL = process.argv.includes('--full');

/**
 * 대상 프로젝트 ID — 환경변수가 없으면 `.firebaserc`의 default.
 *
 * **고정하지 않으면 조용히 틀린다.** ADC(`gcloud auth application-default login`)는 그 PC에
 * 마지막으로 잡힌 quota project를 딸려 보내는데, 그것이 이 프로젝트가 아닐 수 있다. 그러면
 * 엉뚱한 프로젝트의 Firestore를 조회해 **에러 없이 0건**이 나오고, 운영자는 "문의가 없다"고
 * 믿게 된다. 2026-08-24에 실제로 발생했다 — quota project가 다른 프로젝트로 잡힌 PC에서
 * 이 스크립트가 "등록된 피드백이 없습니다"를 출력했다. seed-calendar-bindings.ts가 같은
 * 함정을 겪고 남긴 처방을 그대로 따르고, 조회한 프로젝트를 첫 줄에 찍어 눈으로 확인되게 한다.
 */
function resolveProjectId(): string | undefined {
    const fromEnv = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
    if (fromEnv) return fromEnv;
    try {
        const scriptDir = dirname(fileURLToPath(import.meta.url));
        const rc = JSON.parse(readFileSync(resolve(scriptDir, '../.firebaserc'), 'utf8'));
        return rc?.projects?.default;
    } catch {
        return undefined;
    }
}

const PROJECT_ID = resolveProjectId();

// Firebase Admin 초기화
try {
    initializeApp({ credential: applicationDefault(), ...(PROJECT_ID ? { projectId: PROJECT_ID } : {}) });
} catch {
    console.error('❌ Firebase 인증 실패. GOOGLE_APPLICATION_CREDENTIALS를 설정하거나 gcloud auth로 인증하세요.');
    process.exit(1);
}

const db = getFirestore();

async function main(): Promise<void> {
    console.log('\n📋 피드백 조회 리포트');
    console.log('─'.repeat(50));
    // 조회 대상을 먼저 찍는다 — 0건이 "없음"인지 "엉뚱한 곳을 봤음"인지 여기서 갈린다.
    console.log(`대상 프로젝트: ${PROJECT_ID ?? '(미지정 — ADC 기본값. 결과를 믿지 말 것)'}`);

    // 전체 통계
    const allSnap = await db.collection('feedbacks').get();
    const allDocs = allSnap.docs.map(d => ({ id: d.id, ...d.data() } as Record<string, unknown>));

    if (allDocs.length === 0) {
        console.log('\n✅ 등록된 피드백이 없습니다.');
        console.log('   (위 대상 프로젝트가 맞는지 먼저 확인할 것 — 엉뚱한 프로젝트를 조회해도 0건이 나온다)\n');
        return;
    }

    // 타입별 통계
    const byType: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    allDocs.forEach((fb: Record<string, unknown>) => {
        const type = fb.type || 'other';
        const status = fb.status || 'pending';
        byType[type] = (byType[type] || 0) + 1;
        byStatus[status] = (byStatus[status] || 0) + 1;
    });

    console.log(`\n📊 전체 통계 (총 ${allDocs.length}건)`);
    console.log('\n  타입별:');
    Object.entries(byType).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
        const emoji = type === 'bug' ? '🐛' : type === 'feature' ? '💡' : '📝';
        console.log(`    ${emoji} ${type}: ${count}건`);
    });

    console.log('\n  상태별:');
    Object.entries(byStatus).sort((a, b) => b[1] - a[1]).forEach(([status, count]) => {
        const emoji = status === 'pending' ? '⏳' : status === 'resolved' ? '✅' : '🔄';
        console.log(`    ${emoji} ${status}: ${count}건`);
    });

    // 목록 — 날짜·키워드로 좁힐 수 있다
    let query = db.collection('feedbacks').orderBy('createdAt', 'desc');
    if (SINCE) {
        const since = new Date(`${SINCE}T00:00:00+09:00`);
        if (Number.isNaN(since.getTime())) {
            console.error(`❌ --since 날짜를 읽을 수 없습니다: ${SINCE} (형식: YYYY-MM-DD)`);
            process.exit(1);
        }
        // createdAt 한 필드의 범위 + 같은 필드 정렬이므로 복합 인덱스가 필요하지 않다.
        query = query.where('createdAt', '>=', Timestamp.fromDate(since));
    }
    // 키워드는 메모리에서 거르므로, 거르기 전 표본을 넉넉히 받는다.
    const snap = await query.limit(SEARCH ? Math.max(LIMIT * 20, 500) : LIMIT).get();

    const matched = SEARCH
        ? snap.docs.filter(d => {
            const fb = d.data();
            const text = `${fb.message || ''} ${fb.content || ''} ${fb.title || ''}`;
            return text.includes(SEARCH);
        }).slice(0, LIMIT)
        : snap.docs;

    const scope = [
        SINCE ? `${SINCE} 이후` : null,
        SEARCH ? `'${SEARCH}' 포함` : null,
    ].filter(Boolean).join(' · ');
    console.log(`\n📝 ${scope || '최근'} 피드백 — ${matched.length}건${scope ? ` (조회 범위 ${snap.size}건 중)` : ` (최대 ${LIMIT}건)`}`);
    console.log('─'.repeat(50));

    if (matched.length === 0) {
        console.log('\n  해당하는 문의가 없습니다.');
    }

    matched.forEach((doc, i) => {
        const fb = doc.data();
        // 분까지 보여 준다 — 같은 날 여러 건이 몰린 경우 시각이 판정의 근거가 된다.
        const date = fb.createdAt?.toDate?.()?.toISOString?.()?.slice(0, 16).replace('T', ' ') || '날짜 없음';
        const type = fb.type || 'other';
        const status = fb.status || 'pending';
        const statusEmoji = status === 'pending' ? '⏳' : status === 'resolved' ? '✅' : '🔄';
        const typeEmoji = type === 'bug' ? '🐛' : type === 'feature' ? '💡' : '📝';

        console.log(`\n  ${i + 1}. [${statusEmoji} ${status}] ${typeEmoji} ${type}`);
        console.log(`     날짜: ${date}`);
        const body = String(fb.message || fb.content || '');
        console.log(`     내용: ${FULL ? body : body.slice(0, 100)}`);
        if (fb.email) console.log(`     작성자: ${fb.email}`);
    });

    // 미해결 피드백 강조
    const pendingCount = byStatus['pending'] || 0;
    if (pendingCount > 0) {
        console.log(`\n⚠️  미처리 피드백 ${pendingCount}건이 있습니다.`);
    } else {
        console.log('\n✅ 모든 피드백이 처리되었습니다.');
    }

    console.log('');
}

main().catch(err => {
    console.error('❌ 오류:', err.message);
    process.exit(1);
});
