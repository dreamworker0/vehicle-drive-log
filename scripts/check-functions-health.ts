#!/usr/bin/env node
/**
 * Cloud Functions 상태 리포트 스크립트
 * Firebase CLI를 통해 최근 로그를 분석하여 에러/경고 빈도를 출력합니다.
 * 실행: node scripts/check-functions-health.js
 */
import { execSync } from 'child_process';

const FUNCTIONS = [
    'ocrDashboard', 'ocrDocument', 'autoVerifyDocument',
    'holidayProxy', 'tmapProxy',
    'dailyNightlyBatch', 'monthlyBatch',
    'reservationReminder', 'syncCalendarToApp',
    'onReservationCreated', 'onReservationUpdated', 'onReservationDeleted',
    'sendAdminNotice', 'sendInactiveOrgAlimtalkScheduled', 'apiHealthCheck',
];

console.log('📊 Cloud Functions 상태 리포트');
console.log('═'.repeat(50));
console.log(`검사 대상: ${FUNCTIONS.length}개 함수\n`);

try {
    // 최근 100줄 로그 가져오기
    // - 전역 firebase CLI 사용: npx firebase-tools는 매 실행 다운로드로 타임아웃이 잦다.
    // - stderr는 stdio 옵션으로 버린다 — 셸 리다이렉트(2>/dev/null)는 Windows cmd에서
    //   /dev/null 경로를 찾지 못해 스크립트 자체가 실패한다.
    const logs = execSync(
        'firebase functions:log --lines 100',
        { encoding: 'utf-8', timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] }
    );

    const lines = logs.split('\n').filter(Boolean);

    let errorCount = 0;
    let warningCount = 0;
    const errorFunctions: Record<string, number> = {};

    for (const line of lines) {
        // firebase functions:log 형식: "<ISO타임스탬프> <심각도문자> <함수명>: <메시지>"
        // 심각도 문자(D/I/W/E)로만 분류한다 — 본문의 "error" 문자열 매칭은 DEBUG 폴백
        // 로그(예: Remote Config NOT_FOUND → 기본값 사용)까지 에러로 오분류한다.
        const m = line.match(/^\S+\s+([DIWE])\s+(\S+?):/);
        if (!m) continue;
        const [, severity, fnName] = m;
        if (severity === 'E') {
            errorCount++;
            errorFunctions[fnName] = (errorFunctions[fnName] || 0) + 1;
        } else if (severity === 'W') {
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
} catch (err: unknown) {
    console.log('⚠️  로그 조회 실패 — Firebase CLI 인증 또는 네트워크 확인 필요');
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.log(`   상세: ${errorMessage.slice(0, 100)}`);
    console.log('\n💡 팁: "firebase login" 실행 후 다시 시도하세요.');
}
