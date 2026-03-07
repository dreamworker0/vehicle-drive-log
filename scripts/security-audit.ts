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

function runAudit(dir: string, label: string): AuditCounts {
    console.log(`\n🔍 ${label} 보안 감사 (${dir})`);
    console.log('─'.repeat(50));

    try {
        const result = execSync('npm audit --json 2>/dev/null', {
            cwd: dir,
            encoding: 'utf-8',
            timeout: 30000,
        });

        const audit = JSON.parse(result);
        const vulns: Record<string, any> = audit.vulnerabilities || {};
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
    } catch (err: any) {
        // npm audit가 취약점 발견 시 비정상 종료 코드를 반환함
        try {
            const output = err.stdout || '';
            const audit = JSON.parse(output);
            const vulns: Record<string, any> = audit.vulnerabilities || {};
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
            console.log('   ⚠️  audit 실행 실패:', err.message?.slice(0, 100));
            return { critical: 0, high: 0, moderate: 0, low: 0 };
        }
    }
}

console.log('🛡️  보안 감사 리포트');
console.log('═'.repeat(50));

const frontendCounts = runAudit(ROOT, '프론트엔드');
const functionsCounts = runAudit(resolve(ROOT, 'functions'), 'Cloud Functions');

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
