#!/usr/bin/env node
/**
 * check-feedbacks.js — 피드백 데이터 조회 스크립트
 *
 * Firebase Admin SDK를 이용하여 feedbacks 컬렉션에서
 * 최근 피드백을 조회하고 타입별/상태별 요약을 출력합니다.
 *
 * 사용법:
 *   node scripts/check-feedbacks.js [--limit=30]
 *
 * 환경:
 *   GOOGLE_APPLICATION_CREDENTIALS 환경변수에 서비스 계정 키 경로 필요
 *   또는 Firebase CLI로 인증된 상태여야 합니다.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

// --- 설정 ---
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '30', 10);

// Firebase Admin 초기화
try {
    initializeApp({ credential: applicationDefault() });
} catch {
    console.error('❌ Firebase 인증 실패. GOOGLE_APPLICATION_CREDENTIALS를 설정하거나 gcloud auth로 인증하세요.');
    process.exit(1);
}

const db = getFirestore();

async function main(): Promise<void> {
    console.log('\n📋 피드백 조회 리포트');
    console.log('─'.repeat(50));

    // 전체 통계
    const allSnap = await db.collection('feedbacks').get();
    const allDocs = allSnap.docs.map(d => ({ id: d.id, ...d.data() } as Record<string, any>));

    if (allDocs.length === 0) {
        console.log('\n✅ 등록된 피드백이 없습니다.\n');
        return;
    }

    // 타입별 통계
    const byType: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    allDocs.forEach((fb: Record<string, any>) => {
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

    // 최근 피드백 목록
    const recentSnap = await db.collection('feedbacks')
        .orderBy('createdAt', 'desc')
        .limit(LIMIT)
        .get();

    console.log(`\n📝 최근 피드백 (최대 ${LIMIT}건)`);
    console.log('─'.repeat(50));

    recentSnap.docs.forEach((doc, i) => {
        const fb = doc.data();
        const date = fb.createdAt?.toDate?.()?.toISOString?.()?.slice(0, 10) || '날짜 없음';
        const type = fb.type || 'other';
        const status = fb.status || 'pending';
        const statusEmoji = status === 'pending' ? '⏳' : status === 'resolved' ? '✅' : '🔄';
        const typeEmoji = type === 'bug' ? '🐛' : type === 'feature' ? '💡' : '📝';

        console.log(`\n  ${i + 1}. [${statusEmoji} ${status}] ${typeEmoji} ${type}`);
        console.log(`     날짜: ${date}`);
        console.log(`     내용: ${(fb.message || fb.content || '').slice(0, 100)}`);
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
