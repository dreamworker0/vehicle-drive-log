#!/usr/bin/env node
/**
 * 보안 감사 스크립트 — npm audit 결과를 파싱하여 심각도별 리포트 출력
 * 실행: node scripts/security-audit.js
 */
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

interface AuditCounts {
    critical: number;
    high: number;
    moderate: number;
    low: number;
}

/**
 * 알려진 수용(accepted) 취약점 등록부.
 * 업스트림 미패치/미유지보수 transitive라 깨끗이 못 고치고 강제 시 도구가 깨지는 것들을
 * 사유·재검토 조건과 함께 추적한다. 재검토 조건 충족 시 제거하고 정식 패치한다.
 *
 * 현재: 비어 있음(수용 중인 항목 없음).
 *  - js-yaml DoS(GHSA-h67p-54hq-rp68, functions moderate 20건의 단일 근본)는
 *    functions/package.json의 overrides(js-yaml ^4.2.0) + jest coverageProvider 'v8'로
 *    2026-06-19 실제 해소(audit 0). v8은 babel-plugin-istanbul/load-nyc-config 경로를
 *    타지 않아 js-yaml 4.x로도 커버리지가 정상 동작한다.
 *  - @sentry/node otel(GHSA-8988-4f7v-96qf)은 non-breaking audit fix로 해소됨.
 */
const KNOWN_ACCEPTED: {
    advisory: string; pkg: string; severity: string; scope: string; reason: string; revisitWhen: string;
}[] = [];

function runAudit(dir: string, label: string): AuditCounts | null {
    console.log(`\n🔍 ${label} 보안 감사 (${dir})`);
    console.log('─'.repeat(50));

    try {
        const result = execSync('npm audit --json', {
            cwd: dir,
            encoding: 'utf-8',
            timeout: 30000,
            stdio: ['pipe', 'pipe', 'ignore']
        });

        const audit = JSON.parse(result);
        const vulns: Record<string, unknown> = audit.vulnerabilities || {};
        const counts: AuditCounts = { critical: 0, high: 0, moderate: 0, low: 0 };

        for (const [, info] of Object.entries(vulns)) {
            const severity = (info.severity || 'low') as keyof AuditCounts;
            if (counts[severity] !== undefined) counts[severity]++;
        }

        const total = Object.values(counts).reduce((a, b) => a + b, 0);

        if (total === 0) {
            console.log('   ✅ 취약점 없음');
        } else {
            if (counts.critical > 0) console.log(`   🔴 Critical: ${counts.critical}`);
            if (counts.high > 0) console.log(`   🟠 High: ${counts.high}`);
            if (counts.moderate > 0) console.log(`   🟡 Moderate: ${counts.moderate}`);
            if (counts.low > 0) console.log(`   🟢 Low: ${counts.low}`);
        }

        return counts;
    } catch (err: unknown) {
        // npm audit가 취약점 발견 시 비정상 종료 코드를 반환함
        try {
            const errorObj = err as { stdout?: string };
            const output = errorObj.stdout || '';
            const audit = JSON.parse(output);
            const vulns: Record<string, unknown> = audit.vulnerabilities || {};
            const counts: AuditCounts = { critical: 0, high: 0, moderate: 0, low: 0 };

            for (const [, info] of Object.entries(vulns)) {
                const severity = (info.severity || 'low') as keyof AuditCounts;
                if (counts[severity] !== undefined) counts[severity]++;
            }


            if (counts.critical > 0) console.log(`   🔴 Critical: ${counts.critical}`);
            if (counts.high > 0) console.log(`   🟠 High: ${counts.high}`);
            if (counts.moderate > 0) console.log(`   🟡 Moderate: ${counts.moderate}`);
            if (counts.low > 0) console.log(`   🟢 Low: ${counts.low}`);

            return counts;
        } catch {
            const errorMessage = err instanceof Error ? err.message : String(err);
            console.log('   ⚠️  audit 실행 실패:', errorMessage.slice(0, 100));
            // fail-closed: 실행/파싱 실패를 취약점 0건으로 위장하지 않는다 (2026-07-10 감사 하드닝)
            return null;
        }
    }
}

console.log('🛡️  보안 감사 리포트');
console.log('═'.repeat(50));

const frontendCounts = runAudit(ROOT, '프론트엔드');
const functionsCounts = runAudit(resolve(ROOT, 'functions'), 'Cloud Functions');

// fail-closed: 감사 자체가 실행/파싱 불가면 "취약점 없음"이 아니라 실패로 처리한다.
if (frontendCounts === null || functionsCounts === null) {
    console.log('\n🚨 보안 감사를 실행/파싱하지 못했습니다 — fail-closed로 중단합니다.');
    process.exit(1);
}

if (KNOWN_ACCEPTED.length > 0) {
    console.log('\n📋 알려진 수용 취약점 (문서화된 accepted-risk — 업스트림 패치 대기)');
    console.log('─'.repeat(50));
    for (const a of KNOWN_ACCEPTED) {
        console.log(`   • [${a.severity}] ${a.pkg}  (${a.advisory})`);
        console.log(`     범위: ${a.scope}`);
        console.log(`     사유: ${a.reason}`);
        console.log(`     재검토: ${a.revisitWhen}`);
    }
}

console.log('\n' + '═'.repeat(50));
const totalCritical = frontendCounts.critical + functionsCounts.critical;
const totalHigh = frontendCounts.high + functionsCounts.high;

if (totalCritical > 0) {
    console.log(`\n🚨 Critical 취약점 ${totalCritical}개 발견! 즉시 조치 필요`);
    process.exit(1);
} else if (totalHigh > 0) {
    // High도 CI 실패로 처리 (과거엔 경고만 하고 통과시켜 고위험을 방치할 수 있었음)
    console.log(`\n🚨 High 취약점 ${totalHigh}개 발견! 조치 필요`);
    process.exit(1);
} else {
    console.log('\n✅ 심각한 취약점 없음');
}
