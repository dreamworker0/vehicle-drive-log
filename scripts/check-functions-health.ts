#!/usr/bin/env node
/**
 * Cloud Functions 상태 리포트 스크립트
 * Firebase CLI를 통해 최근 로그를 분석하여 에러/경고 빈도를 출력합니다.
 * 실행: node scripts/check-functions-health.js
 */
import { execSync } from 'child_process';

const FUNCTIONS = [
    'ocrDashboard', 'ocrDocument', 'autoVerifyDocument',
    'holidayProxy', 'syncHolidaysScheduled', 'tmapProxy',
    'backupFirestore', 'autoPurgeOrgs', 'archiveDriveLogs',
    'reservationReminder', 'warmupOcr',
    'onReservationCreated', 'onReservationUpdated', 'onReservationDeleted',
    'syncCalendarToApp', 'sendAdminNotice',
];

console.log('📊 Cloud Functions 상태 리포트');
console.log('═'.repeat(50));
console.log(`검사 대상: ${FUNCTIONS.length}개 함수\n`);

try {
    // 최근 100줄 로그 가져오기
    const logs = execSync(
        'npx firebase-tools functions:log --limit 100 2>/dev/null',
        { encoding: 'utf-8', timeout: 30000 }
    );

    const lines = logs.split('\n').filter(Boolean);

    let errorCount = 0;
    let warningCount = 0;
    const errorFunctions: Record<string, number> = {};

    for (const line of lines) {
        const lower = line.toLowerCase();
        if (lower.includes('error') || lower.includes('failed') || lower.includes('exception')) {
            errorCount++;
            // 함수명 추출 시도
            for (const fn of FUNCTIONS) {
                if (line.includes(fn)) {
                    errorFunctions[fn] = (errorFunctions[fn] || 0) + 1;
                    break;
                }
            }
        } else if (lower.includes('warning') || lower.includes('warn')) {
            warningCount++;
        }
    }

    console.log(`전체 로그 라인: ${lines.length}`);
    console.log(`   🔴 에러: ${errorCount}`);
    console.log(`   🟡 경고: ${warningCount}`);

    if (Object.keys(errorFunctions).length > 0) {
        console.log('\n함수별 에러 빈도:');
        for (const [fn, count] of Object.entries(errorFunctions).sort((a, b) => (b[1] as number) - (a[1] as number))) {
            console.log(`   ${fn}: ${count}회`);
        }
    }

    console.log('\n' + '═'.repeat(50));
    if (errorCount === 0) {
        console.log('✅ 최근 로그에 에러 없음');
    } else if (errorCount <= 5) {
        console.log(`⚠️  소수 에러 발견 (${errorCount}회). 모니터링을 계속하세요.`);
    } else {
        console.log(`🚨 에러 빈도 높음 (${errorCount}회)! 점검이 필요합니다.`);
    }
} catch (err: any) {
    console.log('⚠️  로그 조회 실패 — Firebase CLI 인증 또는 네트워크 확인 필요');
    console.log(`   상세: ${err.message?.slice(0, 100)}`);
    console.log('\n💡 팁: "firebase login" 실행 후 다시 시도하세요.');
}
