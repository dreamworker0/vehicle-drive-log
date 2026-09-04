#!/usr/bin/env node
/**
 * Cloud Functions 상태 리포트 스크립트
 * Firebase CLI를 통해 최근 로그를 분석하여 에러/경고 빈도를 출력합니다.
 * 실행: npm run health
 */
import { execSync } from 'child_process';
import { realpathSync } from 'fs';
import { resolve, basename } from 'path';
import { fileURLToPath } from 'url';

// 로그 조회 줄 수. 이 스크립트의 판정 범위는 "최근 N줄"이지 "최근 24시간"이 아니다 —
// 조용한 함수는 이 창에 아예 등장하지 않으므로, 아래에서 실제로 커버된 시간 구간을
// 함께 출력해 "에러 0건"이 어느 범위의 0건인지 드러낸다.
const LOG_LINES = 300;

/**
 * 에러 한 줄의 출처. 셋을 한 숫자로 합치면 리포트가 거짓말을 한다.
 *
 * - `deploy` — 플랫폼 감사 로그(`google.cloud.audit.AuditLog`). 배포 중 `UpdateFunction`이
 *   분당 mutation 쿼터에 걸리면 여기 ERROR로 남는데, Firebase CLI가 `Waiting to retry...`
 *   후 재시도해 대개 성공한다. **함수가 실행 중에 실패한 것이 아니다.**
 * - `request` — 본문 없는 요청 로그. 심각도가 HTTP 응답 상태에서 유래한다. 함수가 4xx/5xx로
 *   응답했다는 뜻이지 예외가 터졌다는 뜻은 아니다(정상적인 거절도 여기 들어온다).
 * - `app` — 함수가 직접 남긴 ERROR 로그. 코드가 "이건 문제다"라고 판단해 남긴 것이므로
 *   가장 무겁게 본다.
 */
export type ErrorKind = 'deploy' | 'request' | 'app';

export interface HealthReport {
    /** 파싱에 성공한 로그 라인 수 */
    parsed: number;
    /** 함수가 직접 남긴 ERROR */
    appErrors: number;
    /** 4xx/5xx 응답으로 생긴 요청 로그 */
    requestErrors: number;
    /** 배포 중 플랫폼이 남긴 ERROR (판정 제외) */
    deployEvents: number;
    /** 그중 쿼터 초과 — CLI가 재시도하므로 대개 무해하다 */
    deployQuotaEvents: number;
    warnings: number;
    /** 판정 대상 = appErrors + requestErrors */
    runtimeErrors: number;
    /** 함수별 런타임 에러 빈도 (배포 이벤트 제외) */
    errorFunctions: Record<string, { app: number; request: number }>;
    /** 배포 이벤트가 걸린 함수명 */
    deployFunctions: string[];
    seenFunctions: string[];
    firstTimestamp: string | null;
    lastTimestamp: string | null;
}

/**
 * **배포 시점의** 플랫폼 감사 로그인가.
 *
 * `@type`만 보면 모든 Cloud Audit Log가 걸린다 — Admin Activity·Data Access·Policy Denied가
 * 전부 같은 타입이다. 그중 정책 거부(policy_denied)는 실제 호출이 막힌 것이라 판정에서
 * 빼면 안 된다. 그래서 배포를 뜻하는 메서드명까지 함께 본다.
 */
function isDeployAuditLog(body: string): boolean {
    if (!body.includes('google.cloud.audit.AuditLog')) return false;
    return body.includes('FunctionService.UpdateFunction')
        || body.includes('FunctionService.CreateFunction')
        || body.includes('FunctionService.DeleteFunction');
}

/**
 * `firebase functions:log` 출력을 분류해 집계한다.
 *
 * 형식: `<ISO타임스탬프> <심각도문자> <함수명>: <메시지>`
 * 심각도 문자(D/I/W/E)로만 분류한다 — 본문의 "error" 문자열 매칭은 DEBUG 폴백
 * 로그(예: Remote Config NOT_FOUND → 기본값 사용)까지 에러로 오분류한다.
 */
export function summarizeLogs(raw: string): HealthReport {
    // \r까지 함께 끊는다. Windows의 firebase CLI는 CRLF로 내보내는데, 줄 끝에 \r이 남으면
    // 아래 정규식의 `$` 앵커가 걸려 **한 줄도 파싱되지 않는다**. 그러면 이 리포트는 조용히
    // "에러 없음"을 출력한다 — 감시기가 fail-open으로 도는 최악의 모양이다.
    const lines = raw.split(/\r?\n/).filter(Boolean);

    const report: HealthReport = {
        parsed: 0,
        appErrors: 0,
        requestErrors: 0,
        deployEvents: 0,
        deployQuotaEvents: 0,
        warnings: 0,
        runtimeErrors: 0,
        errorFunctions: {},
        deployFunctions: [],
        seenFunctions: [],
        firstTimestamp: null,
        lastTimestamp: null,
    };

    const seen = new Set<string>();
    const deployFns = new Set<string>();
    const timestamps: string[] = [];

    for (const line of lines) {
        // firebase CLI는 severity의 **첫 글자**만 찍는다 — D I N W E C A ? 가 가능하다.
        // 예전 정규식은 DIWE만 받아 CRITICAL·ALERT 줄을 통째로 흘렸다. ERROR보다 무거운
        // 두 등급이 집계에도, `parsed` 카운트에도 안 잡혀 fail-loud 가드까지 비껴갔다.
        const m = line.match(/^(\S+)\s+([DINWECA?])\s+(\S+?):(.*)$/);
        if (!m) continue;
        const [, timestamp, severity, fnName, body] = m;

        report.parsed++;
        timestamps.push(timestamp);
        seen.add(fnName);

        if (severity === 'W') {
            report.warnings++;
            continue;
        }
        // C(critical)·A(alert)는 E보다 무겁다. 같은 무게로 세지 않으면 더 심각한 쪽이
        // 조용히 사라진다.
        if (severity !== 'E' && severity !== 'C' && severity !== 'A') continue;

        const kind = classifyError(body);
        if (kind === 'deploy') {
            report.deployEvents++;
            deployFns.add(fnName);
            // 쿼터 초과는 CLI가 재시도한다. 그 밖의 배포 실패는 사람이 봐야 하므로 따로 센다.
            // 문구가 바뀌어도 살아남도록 gRPC 코드 8(RESOURCE_EXHAUSTED)을 함께 본다.
            // 영문 문구만 보면 구글이 표현을 바꾸는 순간 모든 쿼터 재시도가
            // "쿼터가 아닌 배포 실패"로 뒤집혀 이 PR이 없앤 노이즈가 되돌아온다.
            if (body.includes('Quota exceeded') || body.includes('"code":8')) report.deployQuotaEvents++;
            continue;
        }

        const bucket = report.errorFunctions[fnName] ?? { app: 0, request: 0 };
        bucket[kind]++;
        report.errorFunctions[fnName] = bucket;
        if (kind === 'app') report.appErrors++;
        else report.requestErrors++;
    }

    report.runtimeErrors = report.appErrors + report.requestErrors;
    report.seenFunctions = [...seen].sort();
    report.deployFunctions = [...deployFns].sort();
    if (timestamps.length > 0) {
        const sorted = [...timestamps].sort();
        report.firstTimestamp = sorted[0];
        report.lastTimestamp = sorted[sorted.length - 1];
    }
    return report;
}

/** ERROR 한 줄의 출처를 가른다 (위 ErrorKind 주석 참고) */
export function classifyError(body: string): ErrorKind {
    if (isDeployAuditLog(body)) return 'deploy';
    // 본문이 비면 Cloud Run 요청 로그다 — 심각도는 HTTP 상태에서 온 것이다.
    return body.trim().length === 0 ? 'request' : 'app';
}

/**
 * 로그가 하나도 없을 때 CLI가 찍는 안내문인가.
 *
 * `firebase functions:log`는 결과가 없으면 `No log entries found.` 한 줄만 내보낸다.
 * 이건 파싱 실패가 아니라 정상적인 "빈 결과"다.
 */
export function isEmptyLogNotice(lines: string[]): boolean {
    return lines.length > 0 && lines.every((l) => /^\s*No log entries found\.?\s*$/i.test(l));
}

function render(report: HealthReport, rawLines: string[]): void {
    const totalLines = rawLines.length;
    console.log(`전체 로그 라인: ${totalLines}`);

    // 줄은 받았는데 한 줄도 해석하지 못했다면, "에러 없음"은 사실이 아니라 **아무것도 못 본
    // 것**이다. 실제로 CRLF 하나 때문에 이 상태로 ✅를 출력한 적이 있다(2026-09-04).
    // 형식이 바뀌면 조용히 통과하지 말고 여기서 멈춘다.
    //
    // 단, 로그가 정말 없을 때 CLI가 찍는 안내문("No log entries found.")은 형식이 바뀐 게
    // 아니다. 이걸 구분하지 않으면 조용한 프로젝트에서 매번 거짓 경보가 뜬다.
    if (totalLines > 0 && report.parsed === 0 && !isEmptyLogNotice(rawLines)) {
        console.log('\n🚨 로그를 한 줄도 해석하지 못했습니다 — 출력 형식이 바뀐 것으로 보입니다.');
        console.log('   "에러 없음"이 아니라 "아무것도 확인하지 못함"이므로 판정을 중단합니다.');
        process.exitCode = 1;
        return;
    }

    console.log(`   🔴 함수가 남긴 에러: ${report.appErrors}`);
    console.log(`   🟠 4xx/5xx 응답 로그: ${report.requestErrors}`);
    console.log(`   🟡 경고: ${report.warnings}`);
    if (report.deployEvents > 0) {
        // 판정에서 뺐다는 사실을 숨기지 않는다 — 뺀 것을 안 보여주면 그것도 거짓말이다.
        const quota = report.deployQuotaEvents;
        const other = report.deployEvents - quota;
        console.log(`   ⚪ 배포 이벤트: ${report.deployEvents} (판정 제외)`);
        if (quota > 0) {
            console.log(`      · 쿼터 초과 ${quota}건 — Firebase CLI가 재시도한다. 최종 결과는 Deploy 워크플로 로그에서 확인.`);
        }
        if (other > 0) {
            console.log(`      · ⚠️ 쿼터가 아닌 배포 실패 ${other}건 — 이건 사람이 봐야 한다.`);
        }
        console.log(`      · 대상 함수: ${report.deployFunctions.join(', ')}`);
    }

    if (report.parsed === 0 && isEmptyLogNotice(rawLines)) {
        console.log('\n⚠️  조회 구간에 로그가 하나도 없습니다 — 점검된 것이 없다는 뜻입니다.');
        console.log('   "에러 없음"과 다릅니다. 배포·호출이 정말 없었는지 먼저 확인하세요.');
        return;
    }

    // 판정 범위를 명시한다 — 아래 "에러 0건"은 이 구간·이 함수들에 한정된 0건이다.
    if (report.firstTimestamp) {
        console.log(`\n판정 범위: ${report.firstTimestamp} ~ ${report.lastTimestamp}`);
        console.log(`   로그에 등장한 함수 ${report.seenFunctions.length}개: ${report.seenFunctions.join(', ')}`);
        console.log('   ⚠️ 이 구간에 로그를 남기지 않은 함수는 점검되지 않았다 (조용한 실패는 여기서 안 보인다).');
    }

    const entries = Object.entries(report.errorFunctions);
    if (entries.length > 0) {
        console.log('\n함수별 런타임 에러:');
        for (const [fn, c] of entries.sort((a, b) => (b[1].app + b[1].request) - (a[1].app + a[1].request))) {
            const parts = [];
            if (c.app > 0) parts.push(`함수 로그 ${c.app}회`);
            if (c.request > 0) parts.push(`4xx/5xx 응답 ${c.request}회`);
            console.log(`   ${fn}: ${parts.join(' · ')}`);
        }
    }

    console.log('\n' + '═'.repeat(50));
    // 판정은 런타임 에러만 본다. 배포 이벤트까지 합치면 배포 직후마다 "점검 필요"가 떠서,
    // 정작 진짜 장애가 났을 때 그 경보가 묻힌다.
    // 쿼터 재시도가 아닌 배포 실패(권한 거부·롤백 등)는 판정에 반영한다. 위에 한 줄
    // 찍어 두는 것만으로는 부족하다 — 사람은 구분선 아래 결론을 보고 넘어간다.
    const failedDeploys = report.deployEvents - report.deployQuotaEvents;
    if (failedDeploys > 0) {
        console.log(`⚠️  쿼터가 아닌 배포 실패 ${failedDeploys}건 — 배포가 끝까지 갔는지 확인하세요.`);
        process.exitCode = 1;
    }

    if (report.runtimeErrors === 0) {
        console.log(failedDeploys > 0 ? '   (런타임 에러는 없음)' : '✅ 최근 로그에 런타임 에러 없음');
    } else if (report.runtimeErrors <= 5) {
        console.log(`⚠️  소수 에러 발견 (${report.runtimeErrors}회). 모니터링을 계속하세요.`);
    } else {
        console.log(`🚨 에러 빈도 높음 (${report.runtimeErrors}회)! 점검이 필요합니다.`);
    }
    if (report.appErrors === 0 && report.requestErrors > 0) {
        console.log('   ↳ 전부 응답 상태에서 온 로그다. Cloud Run은 4xx를 WARNING으로 내리므로 여기 남은 것은 5xx다.');
        console.log('      함수가 직접 남긴 에러는 없으니, 어느 응답 경로가 5xx를 내는지부터 확인하라.');
    }
}

function main(): void {
    console.log('📊 Cloud Functions 상태 리포트');
    console.log('═'.repeat(50));
    // 과거에는 하드코딩된 15개 함수 목록을 "검사 대상"으로 출력했다. 실제 분석은 로그에
    // 등장하는 모든 함수를 대상으로 하므로 그 숫자는 근거 없는 축소 표기였고, 반대로
    // 목록에 있는 함수가 로그에 없어도 점검된 것처럼 보였다. 목록을 없애고 실측만 적는다.
    console.log(`최근 로그 ${LOG_LINES}줄을 조회해 심각도별로 집계합니다.\n`);

    try {
        // - 전역 firebase CLI 사용: npx firebase-tools는 매 실행 다운로드로 타임아웃이 잦다.
        // - stderr는 stdio 옵션으로 버린다 — 셸 리다이렉트(2>/dev/null)는 Windows cmd에서
        //   /dev/null 경로를 찾지 못해 스크립트 자체가 실패한다.
        const logs = execSync(
            `firebase functions:log --lines ${LOG_LINES}`,
            { encoding: 'utf-8', timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] }
        );
        render(summarizeLogs(logs), logs.split('\n').filter(Boolean).length);
    } catch (err: unknown) {
        // 형식 변경은 막으면서 조회 실패는 통과시키던 것을 맞춘다 — 인증 만료·네트워크
        // 장애가 훨씬 흔한데, 그때 "확인하지 못함"이 조용히 성공으로 읽혔다.
        process.exitCode = 1;
        console.log('⚠️  로그 조회 실패 — Firebase CLI 인증 또는 네트워크 확인 필요');
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.log(`   상세: ${errorMessage.slice(0, 100)}`);
        console.log('\n💡 팁: "firebase login" 실행 후 다시 시도하세요.');
    }
}

// 직접 실행일 때만 조회한다 (테스트에서 헬퍼만 import할 수 있도록. security-audit.ts와 동일 패턴).
const selfPath = fileURLToPath(import.meta.url);
function realOrSelf(p: string): string {
    try { return realpathSync(p); } catch { return resolve(p); }
}
if (process.argv[1]) {
    const invoked = realOrSelf(process.argv[1]);
    const self = realOrSelf(selfPath);
    if (invoked.toLowerCase() === self.toLowerCase()) main();
    else if (basename(invoked).toLowerCase() === basename(self).toLowerCase()) {
        console.error(
            `🚨 상태 리포트 진입점 판정 실패 — 실행 경로(${invoked})와 모듈 경로(${self})가 다릅니다.`,
        );
        process.exit(1);
    }
}
