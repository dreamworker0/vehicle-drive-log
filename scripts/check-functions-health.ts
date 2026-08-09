#!/usr/bin/env node
/**
 * Cloud Functions 상태 리포트 스크립트
 * Firebase CLI를 통해 최근 로그를 분석하여 에러/경고 빈도를 출력합니다.
 * 실행: node scripts/check-functions-health.js
 */
import { execSync } from 'child_process';

// 로그 조회 줄 수. 이 스크립트의 판정 범위는 "최근 N줄"이지 "최근 24시간"이 아니다 —
// 조용한 함수는 이 창에 아예 등장하지 않으므로, 아래에서 실제로 커버된 시간 구간을
// 함께 출력해 "에러 0건"이 어느 범위의 0건인지 드러낸다.
const LOG_LINES = 300;

console.log('📊 Cloud Functions 상태 리포트');
console.log('═'.repeat(50));
// 과거에는 하드코딩된 15개 함수 목록을 "검사 대상"으로 출력했다. 실제 분석은 로그에
// 등장하는 모든 함수를 대상으로 하므로 그 숫자는 근거 없는 축소 표기였고, 반대로
// 목록에 있는 함수가 로그에 없어도 점검된 것처럼 보였다. 목록을 없애고 실측만 적는다.
console.log(`최근 로그 ${LOG_LINES}줄을 조회해 심각도별로 집계합니다.\n`);

try {
    // 최근 100줄 로그 가져오기
    // - 전역 firebase CLI 사용: npx firebase-tools는 매 실행 다운로드로 타임아웃이 잦다.
    // - stderr는 stdio 옵션으로 버린다 — 셸 리다이렉트(2>/dev/null)는 Windows cmd에서
    //   /dev/null 경로를 찾지 못해 스크립트 자체가 실패한다.
    const logs = execSync(
        `firebase functions:log --lines ${LOG_LINES}`,
        { encoding: 'utf-8', timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] }
    );

    const lines = logs.split('\n').filter(Boolean);

    let errorCount = 0;
    let warningCount = 0;
    const errorFunctions: Record<string, number> = {};
    const seenFunctions = new Set<string>();
    const timestamps: string[] = [];

    for (const line of lines) {
        // firebase functions:log 형식: "<ISO타임스탬프> <심각도문자> <함수명>: <메시지>"
        // 심각도 문자(D/I/W/E)로만 분류한다 — 본문의 "error" 문자열 매칭은 DEBUG 폴백
        // 로그(예: Remote Config NOT_FOUND → 기본값 사용)까지 에러로 오분류한다.
        const m = line.match(/^(\S+)\s+([DIWE])\s+(\S+?):/);
        if (!m) continue;
        const [, timestamp, severity, fnName] = m;
        timestamps.push(timestamp);
        seenFunctions.add(fnName);
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

    // 판정 범위를 명시한다 — 아래 "에러 0건"은 이 구간·이 함수들에 한정된 0건이다.
    if (timestamps.length > 0) {
        const sorted = [...timestamps].sort();
        console.log(`\n판정 범위: ${sorted[0]} ~ ${sorted[sorted.length - 1]}`);
        console.log(`   로그에 등장한 함수 ${seenFunctions.size}개: ${[...seenFunctions].sort().join(', ')}`);
        console.log('   ⚠️ 이 구간에 로그를 남기지 않은 함수는 점검되지 않았다 (조용한 실패는 여기서 안 보인다).');
    }

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
