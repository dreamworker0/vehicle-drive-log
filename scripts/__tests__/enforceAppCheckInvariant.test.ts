/**
 * 콜러블 핸들러의 `enforceAppCheck` 상태를 정적으로 고정한다.
 *
 * 왜 필요한가: `onCall`의 옵션 객체는 export되지 않아 런타임으로 읽을 수 없고, 기존 단위
 * 테스트는 rate-limit 키 이름만 참조하므로 **`enforceAppCheck: true`를 다시 `false`로
 * 되돌려도 전 테스트가 통과**했다(3차 배치 적대적 리뷰에서 발견). 실수로 강제가 풀리거나
 * 새 함수가 `false`로 추가되는 것을 잡는 가드가 없었다.
 *
 * 강제하는 것:
 *  1. 미강제(`false`) 파일 집합이 아래 NOT_ENFORCED와 **정확히 일치**해야 한다 — 강제가
 *     풀리면(집합에 추가되어) 실패하고, 해소되면(집합에서 빠져) 실패한다. 즉 어느 방향으로든
 *     변화는 이 목록의 명시적 갱신을 요구한다.
 *  2. 각 항목의 **근거가 사실인지** 함께 검증한다 — 공개 폼은 실제로 인증을 요구하지 않고,
 *     4차 대기 항목은 실제로 인증을 요구한다. 근거 없이 목록만 늘리지 못하게 한다.
 *
 * 실행 대신 소스를 검사하는 이유: 옵션 변경은 소스 편집이므로 정적 검사로 충분하고,
 * Functions 런타임을 띄우는 비용을 피할 수 있다(`lightEntryForceLightMode.test.ts`와 같은 성격).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HANDLERS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'functions', 'src', 'handlers');

/**
 * 비로그인 공개 경로 — App Check 토큰을 기대할 수 없거나, 강제 시 유입이 막힌다.
 * 강제하지 않는 것이 **확정된 의도**다.
 */
const PUBLIC_EXEMPT: Record<string, string> = {
    'https/submitOrgApplication.ts':
        '비로그인 공개 폼(/apply). 강제 시 기관신청 유입이 막히는 획득 경로',
    'https/submitPublicFeedback.ts':
        '비로그인 공개 피드백 폼. 위와 동일',
};

/**
 * 인증 사용자만 호출하므로 강제가 **가능**하지만 아직 배치에 포함하지 않은 것.
 * 4차(2026-07-25)에서 비용·민감도가 높은 2종을 강제로 옮겼고, 남은 3종은 진단·동기화
 * 계열이라 실패 시 관리자가 원인을 못 찾는 부작용이 커서 다음 배치로 미룬다.
 */
const PENDING_DECISION: Record<string, string> = {
    'callable/sendFeedbackReply.ts': 'superAdmin 피드백 회신 — 같은 훅의 regenerateFeedbackDraft는 이미 강제',
    'callable/testCalendarAccess.ts': 'admin 캘린더 연결 진단 — 연결 문제 진단 도구라 강제가 진단을 막을 수 있다',
    'callable/triggerOnDemandCalendarSync.ts': 'admin 수동 동기화 — 위 진단과 같은 화면·같은 판단',
};

/**
 * 옵션을 **아예 선언하지 않아** 기본값(미강제)에 기대고 있는 것 — 방침이 결정된 적 없다.
 * Slack 멀티테넌트 배치에서 추가되며 App Check 판단이 누락됐다(3차 리뷰 가드가 발견).
 * 넷 다 `!request.auth` 검사가 있고 인증된 관리자 화면(`useSlackIntegration.ts`)에서만
 * 호출되므로 강제가 **가능**하다. 4차 배치에서 위 PENDING_DECISION과 함께 결정한다.
 */
const MISSING_DECLARATION = [
    'callable/diagnoseSlackConnection.ts',
    'callable/disconnectSlack.ts',
    'callable/getSlackConnectionStatus.ts',
    'callable/getSlackInstallUrl.ts',
];

const NOT_ENFORCED = { ...PUBLIC_EXEMPT, ...PENDING_DECISION };

/** 3차 배치 대상 — 남용이 곧 과금(Gemini·알림톡·이메일)이라 개별로도 고정한다 */
const BATCH3_ENFORCED = [
    'callable/askAI.ts',
    'callable/ocrDashboard.ts',
    'callable/ocrDocument.ts',
    'callable/sendManualApprovalAlimtalk.ts',
    'callable/sendManualRejectionAlimtalk.ts',
    'callable/sendApprovalEmail.ts',
    'callable/sendRejectionEmail.ts',
];

/**
 * 4차 배치(2026-07-25) — 비용 팬아웃(FCM)과 민감 문서 노출 경로.
 * 3차와 같은 이유로 개별 고정한다: 목록 비교만으로는 "이 파일이 강제 상태"를 못 박지 못한다.
 */
const BATCH4_ENFORCED = [
    'callable/sendAdminNotice.ts',
    'callable/getOrgDocumentUrl.ts',
];

/** handlers/ 하위 .ts 파일을 재귀 수집 (테스트 제외) */
function collectHandlerFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const full = resolve(dir, name);
        if (statSync(full).isDirectory()) {
            if (name === '__tests__') continue;
            out.push(...collectHandlerFiles(full));
        } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
            out.push(full);
        }
    }
    return out;
}

/** 경로를 handlers/ 기준 POSIX 상대경로로 정규화 (Windows 구분자 흡수) */
function toKey(full: string): string {
    return relative(HANDLERS, full).split(sep).join('/');
}

const handlerFiles = collectHandlerFiles(HANDLERS);
const read = (key: string) => readFileSync(resolve(HANDLERS, key), 'utf-8');

describe('enforceAppCheck 불변식', () => {
    it('핸들러 파일을 실제로 수집한다 (검사가 공회전하지 않도록)', () => {
        // 수집이 0건이면 아래 집합 비교가 무의미하게 통과한다 — 전제를 먼저 고정한다
        expect(handlerFiles.length).toBeGreaterThan(20);
    });

    it('enforceAppCheck: false인 핸들러는 명시 목록과 정확히 일치한다', () => {
        const notEnforced = handlerFiles
            .filter(f => /enforceAppCheck:\s*false/.test(readFileSync(f, 'utf-8')))
            .map(toKey)
            .sort();

        expect(notEnforced).toEqual(Object.keys(NOT_ENFORCED).sort());
    });

    it('enforceAppCheck 미선언 핸들러는 명시 목록과 정확히 일치한다', () => {
        // 방침이 빠진 채 배포되면 정책이 암묵적으로 갈린다. 새 함수가 미선언으로 추가되면 실패한다.
        const missing = handlerFiles
            .filter(f => {
                const src = readFileSync(f, 'utf-8');
                return /\bonCall\s*\(/.test(src) && !/enforceAppCheck\s*:/.test(src);
            })
            .map(toKey)
            .sort();

        expect(missing).toEqual([...MISSING_DECLARATION].sort());
    });

    it('미선언 4종은 인증을 요구한다 (= 강제가 가능한 대상, 4차 결정 대기)', () => {
        for (const key of MISSING_DECLARATION) {
            expect(read(key), `${key}가 인증을 요구하지 않으면 공개 경로로 재분류해야 한다`)
                .toMatch(/requireSuperAdmin\s*\(|!\s*request\.auth\b/);
        }
    });

    it('3차 배치 7종은 강제 상태를 유지한다', () => {
        for (const key of BATCH3_ENFORCED) {
            expect(read(key), `${key}에 enforceAppCheck: true가 없다`).toMatch(/enforceAppCheck:\s*true/);
        }
    });

    it('4차 배치 2종은 강제 상태를 유지한다', () => {
        for (const key of BATCH4_ENFORCED) {
            expect(read(key), `${key}에 enforceAppCheck: true가 없다`).toMatch(/enforceAppCheck:\s*true/);
        }
    });

    describe('근거 검증 — 근거 없이 목록을 늘리지 못하게', () => {
        it('공개 면제 2종은 실제로 인증을 요구하지 않는다', () => {
            for (const key of Object.keys(PUBLIC_EXEMPT)) {
                const src = read(key);
                expect(src, `${key}가 인증을 요구하면 '공개 폼'이라는 근거가 거짓`).not.toMatch(/requireSuperAdmin\s*\(/);
                expect(src).not.toMatch(/!\s*request\.auth\b/);
            }
        });

        it('결정 대기 3종은 실제로 인증을 요구한다 (= 강제가 가능한 대상)', () => {
            for (const key of Object.keys(PENDING_DECISION)) {
                const src = read(key);
                expect(src, `${key}가 인증을 요구하지 않으면 공개 경로로 재분류해야 한다`)
                    .toMatch(/requireSuperAdmin\s*\(|!\s*request\.auth\b/);
            }
        });
    });
});
