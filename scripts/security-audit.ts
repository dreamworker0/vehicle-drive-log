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
 * ⚠️ 여기 등록한 권고는 아래 집계에서 **차감**되어 게이트를 통과한다. 즉 "이 앱에
 * 해당하지 않음"을 근거와 함께 확인한 것만 올린다(단순히 시끄러워서 끄는 용도 아님).
 *
 * 해소되어 제거된 이력:
 *  - js-yaml DoS(GHSA-h67p-54hq-rp68, functions moderate 20건의 단일 근본)는
 *    functions/package.json의 overrides(js-yaml ^4.2.0) + jest coverageProvider 'v8'로
 *    2026-06-19 실제 해소(audit 0). v8은 babel-plugin-istanbul/load-nyc-config 경로를
 *    타지 않아 js-yaml 4.x로도 커버리지가 정상 동작한다.
 *  - @sentry/node otel(GHSA-8988-4f7v-96qf)은 non-breaking audit fix로 해소됨.
 */
interface AcceptedEntry {
    /** GHSA ID 정확히 1개 (형식 검증됨 — 오기입 시 감사가 fail-closed로 중단) */
    advisory: string;
    /** 이 권고의 근본 + 전이로 함께 걸리는 패키지명들. 스코프 패키지(@scope/name)도 배열 원소로 그대로 적는다 */
    pkgs: string[];
    /** 수용 시점의 심각도. audit이 이보다 높게 재평가하면 차감하지 않는다(재평가 트리거) */
    severity: 'low' | 'moderate' | 'high' | 'critical';
    scope: string;
    reason: string;
    revisitWhen: string;
}

const KNOWN_ACCEPTED: AcceptedEntry[] = [
    {
        advisory: 'GHSA-qwww-vcr4-c8h2',
        pkgs: ['react-router', 'react-router-dom'],
        severity: 'high',
        scope: '프론트엔드 (react-router 7.12.0~8.2.0, 현재 7.18.1)',
        reason:
            'RSC(React Server Components) 모드의 서버 액션이 400 응답 전에 실행되는 CSRF 우회. ' +
            '이 앱은 순수 클라이언트 SPA(src/appEntry.tsx·lightEntry.tsx의 BrowserRouter + Vite 정적 빌드)로 ' +
            'RSC·SSR·서버 액션을 전혀 쓰지 않아 취약 코드 경로가 존재하지 않는다. ' +
            '업스트림 패치 버전이 없고 audit fix --force는 7.11.0 breaking 다운그레이드를 요구해 ' +
            '라우팅 회귀 위험이 실익보다 크다(사용자 결정, 2026-07-25).',
        revisitWhen:
            '(1) react-router가 7.12+ 계열 패치 버전을 내면 즉시 상향하고 이 항목 제거, ' +
            '(2) 이 앱이 RSC/SSR·서버 액션을 도입하면 수용 철회하고 재평가.',
    },
];

/** GHSA ID 형식 — 오기입(빈 문자열·접두사만)으로 전체 권고가 차감되는 사고를 원천 차단 */
const GHSA_RE = /^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/;
const SEVERITY_RANK: Record<string, number> = { low: 0, moderate: 1, high: 2, critical: 3 };

/**
 * 등록부 자체를 검증한다 (설정 오류를 취약점 0건으로 위장하지 않기 위해 fail-closed).
 * 이 등록부는 이제 "문서"가 아니라 실행되는 게이트 설정이므로 형식을 강제한다.
 */
export function validateRegistry(): string[] {
    const errors: string[] = [];
    for (const [i, a] of KNOWN_ACCEPTED.entries()) {
        const at = `KNOWN_ACCEPTED[${i}]`;
        if (!GHSA_RE.test(a.advisory)) errors.push(`${at}.advisory가 GHSA 형식이 아님: "${a.advisory}"`);
        if (!Array.isArray(a.pkgs) || a.pkgs.length === 0 || a.pkgs.some((p) => !p || !p.trim())) {
            errors.push(`${at}.pkgs가 비었거나 빈 문자열을 포함`);
        }
        if (SEVERITY_RANK[a.severity] === undefined) errors.push(`${at}.severity가 유효하지 않음: "${a.severity}"`);
        for (const field of ['reason', 'revisitWhen', 'scope'] as const) {
            if (!a[field] || a[field].trim().length < 10) errors.push(`${at}.${field}가 비었거나 너무 짧음(근거 필수)`);
        }
    }
    const dupes = KNOWN_ACCEPTED.map((a) => a.advisory).filter((v, i, arr) => arr.indexOf(v) !== i);
    if (dupes.length > 0) errors.push(`중복 등록: ${[...new Set(dupes)].join(', ')}`);
    return errors;
}

/** 등록 항목별 실제 매칭 횟수 — 0이면 이미 해소된 stale 항목이므로 정리 대상으로 경고한다 */
const acceptedHits = new Map<string, number>();

/**
 * 등록부에 있는 권고인지 판정.
 * npm audit의 `via`는 두 형태가 섞인다 — 직접 권고는 객체(`{url: '…/advisories/GHSA-…'}`),
 * 취약 패키지에 의존해 전이로 걸린 항목은 **문자열 패키지명**(예: react-router-dom의 via `["react-router"]`).
 * 따라서 객체는 권고 ID로, 문자열은 그 패키지가 수용 등록된 근본인지로 매칭한다.
 *
 * fail-closed 설계:
 *  - via 항목이 **전부** 수용 대상이어야 차감한다(미등록 권고가 하나라도 섞이면 그대로 집계).
 *  - URL은 `includes`가 아니라 마지막 경로 세그먼트 **정확 일치**로 본다(부분 문자열 오매칭 방지).
 *  - audit의 심각도가 수용 시점보다 높으면 차감하지 않는다(재평가 트리거를 놓치지 않도록).
 */
export function isAccepted(info: unknown): boolean {
    const via = (info as { via?: unknown[] }).via;
    if (!Array.isArray(via) || via.length === 0) return false;

    // 심각도 상승 시 수용 무효화 (예: high로 수용했는데 critical로 재평가된 경우)
    const sev = (info as { severity?: unknown }).severity;
    const entryForSeverity = KNOWN_ACCEPTED.find((a) =>
        via.some((v) => typeof v === 'object' && v !== null && extractGhsa((v as { url?: unknown }).url) === a.advisory),
    );
    if (typeof sev === 'string' && entryForSeverity) {
        const observed = SEVERITY_RANK[sev] ?? 0;
        if (observed > SEVERITY_RANK[entryForSeverity.severity]) return false;
    }

    const matched: string[] = [];
    const ok = via.every((v) => {
        if (typeof v === 'string') {
            const entry = KNOWN_ACCEPTED.find((a) => a.pkgs.some((p) => p.trim() === v.trim()));
            if (entry) { matched.push(entry.advisory); return true; }
            return false;
        }
        if (typeof v === 'object' && v !== null) {
            const id = extractGhsa((v as { url?: unknown }).url);
            const entry = id ? KNOWN_ACCEPTED.find((a) => a.advisory === id) : undefined;
            if (entry) { matched.push(entry.advisory); return true; }
            return false;
        }
        return false;
    });
    if (ok) for (const id of new Set(matched)) acceptedHits.set(id, (acceptedHits.get(id) ?? 0) + 1);
    return ok;
}

/** advisory URL에서 GHSA ID만 추출 (마지막 경로 세그먼트가 GHSA 형식일 때만) */
export function extractGhsa(url: unknown): string | null {
    if (typeof url !== 'string') return null;
    const last = url.split('/').filter(Boolean).pop() ?? '';
    return GHSA_RE.test(last) ? last : null;
}

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
        let accepted = 0;

        for (const [, info] of Object.entries(vulns)) {
            if (isAccepted(info)) { accepted++; continue; } // 수용 등록된 권고는 차감
            const severity = (info.severity || 'low') as keyof AuditCounts;
            if (counts[severity] !== undefined) counts[severity]++;
        }
        if (accepted > 0) console.log(`   ℹ️  수용 등록 제외: ${accepted}건 (하단 등록부 참고)`);

        const total = Object.values(counts).reduce((a, b) => a + b, 0);

        if (total === 0) {
            console.log(accepted > 0 ? '   ✅ 수용 제외 후 잔여 취약점 없음' : '   ✅ 취약점 없음');
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
            let accepted = 0;

            for (const [, info] of Object.entries(vulns)) {
                if (isAccepted(info)) { accepted++; continue; } // 수용 등록된 권고는 차감
                const severity = (info.severity || 'low') as keyof AuditCounts;
                if (counts[severity] !== undefined) counts[severity]++;
            }
            if (accepted > 0) console.log(`   ℹ️  수용 등록 제외: ${accepted}건 (하단 등록부 참고)`);
            if (Object.values(counts).reduce((a, b) => a + b, 0) === 0) {
                console.log(accepted > 0 ? '   ✅ 수용 제외 후 잔여 취약점 없음' : '   ✅ 취약점 없음');
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

function main(): void {
    console.log('🛡️  보안 감사 리포트');
    console.log('═'.repeat(50));

    // fail-closed: 등록부 오기입(빈 advisory·형식 오류 등)이 전체 권고를 조용히 차감하는 사고를 막는다.
    const registryErrors = validateRegistry();
    if (registryErrors.length > 0) {
        console.log('\n🚨 수용 등록부(KNOWN_ACCEPTED) 설정 오류 — fail-closed로 중단합니다.');
        for (const e of registryErrors) console.log(`   • ${e}`);
        process.exit(1);
    }

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
            const hits = acceptedHits.get(a.advisory) ?? 0;
            console.log(`   • [${a.severity}] ${a.pkgs.join(', ')}  (${a.advisory})  매칭 ${hits}건`);
            console.log(`     범위: ${a.scope}`);
            console.log(`     사유: ${a.reason}`);
            console.log(`     재검토: ${a.revisitWhen}`);
        }
        // 매칭 0건 = 업스트림 패치 등으로 이미 해소된 stale 항목 → 등록부에서 제거해야 한다.
        const stale = KNOWN_ACCEPTED.filter((a) => (acceptedHits.get(a.advisory) ?? 0) === 0);
        if (stale.length > 0) {
            console.log('\n   ⚠️  아래 항목은 이번 감사에서 매칭되지 않았습니다(이미 해소된 것으로 보임).');
            console.log('      등록부에서 제거하세요 — 남겨두면 불필요한 차감 규칙이 계속 살아 있습니다:');
            for (const a of stale) console.log(`      • ${a.advisory} (${a.pkgs.join(', ')})`);
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
}

// 직접 실행일 때만 감사를 수행한다 (테스트에서 헬퍼만 import할 수 있도록. check-harness.ts와 동일 패턴)
const selfPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === selfPath.toLowerCase()) {
    main();
}
