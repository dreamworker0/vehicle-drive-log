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
 * 미유지보수 transitive 의존성이라 지금은 깨끗이 고칠 수 없고, 강제 override 시
 * 도구가 깨지는 것들. 사유·재검토 조건을 명시해 "방치"가 아닌 "알고 수용 중"으로
 * 추적한다. 재검토 조건이 충족되면 제거하고 정식 패치한다.
 * (2026-06-19 등록 / 같은 날 정정: @sentry/node otel 항목은 audit에서 해소되어 제거.
 *  현재 functions의 moderate 20건은 전부 아래 js-yaml advisory 하나가 근본 원인이다.)
 */
const KNOWN_ACCEPTED: {
    advisory: string; pkg: string; severity: string; scope: string; reason: string; revisitWhen: string;
}[] = [
    {
        advisory: 'GHSA-h67p-54hq-rp68',
        pkg: 'js-yaml@3.x (via @istanbuljs/load-nyc-config ← babel-plugin-istanbul ← jest 트리)',
        severity: 'moderate',
        scope: 'dev/test 전용 (jest 커버리지 시점 yaml 파싱 — 프로덕션 런타임 무관, 실노출 ~0)',
        reason: 'functions의 moderate 20건은 서로 다른 취약점이 아니라 이 js-yaml advisory 하나가 jest 의존성 트리(@jest/* · babel-jest · ts-jest · firebase-functions-test 등) 전체로 전파돼 패키지마다 카운트된 것. load-nyc-config@1.1.0(최신·미유지보수)가 js-yaml ^3.x로 고정하고, babel-plugin-istanbul@8(최신)·jest 30도 동일 체인. 패치된 js-yaml 4.2.0은 API 비호환이라 강제 시 커버리지 파손.',
        revisitWhen: 'istanbul/jest가 load-nyc-config를 벗어나거나 js-yaml 4.x로 이동하면 제거.',
    },
];

function runAudit(dir: string, label: string): AuditCounts {
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
            return { critical: 0, high: 0, moderate: 0, low: 0 };
        }
    }
}

console.log('🛡️  보안 감사 리포트');
console.log('═'.repeat(50));

const frontendCounts = runAudit(ROOT, '프론트엔드');
const functionsCounts = runAudit(resolve(ROOT, 'functions'), 'Cloud Functions');

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
    console.log(`\n⚠️  High 취약점 ${totalHigh}개 발견. 조치를 검토하세요.`);
} else {
    console.log('\n✅ 심각한 취약점 없음');
}
