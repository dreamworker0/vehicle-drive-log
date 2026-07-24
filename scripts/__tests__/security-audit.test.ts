// 보안 감사 게이트(security-audit.ts)의 수용 등록부·리포트 파싱 단위 테스트.
// 이 게이트는 pre-push·CI에서 하드 게이트로 쓰이므로, 수용 차감이 의도한 권고에만
// 적용되고 그 밖에는 fail-closed인지가 핵심 계약이다.
//
// 테스트는 살아있는 KNOWN_ACCEPTED에 의존하지 않고 픽스처 등록부를 주입한다.
// (등록 항목이 해소되어 제거될 때 테스트가 깨져 정리를 막는 일이 없도록)
import { describe, it, expect, beforeEach } from 'vitest';
import {
    isAccepted,
    extractGhsa,
    validateRegistry,
    summarizeAudit,
    resetAcceptedHits,
    getAcceptedHits,
} from '../security-audit';

const FIX_ID = 'GHSA-aaaa-bbbb-cccc';
const FIX_URL = `https://github.com/advisories/${FIX_ID}`;
const OTHER_ID = 'GHSA-dddd-eeee-ffff';
const OTHER_URL = `https://github.com/advisories/${OTHER_ID}`;

/** 픽스처 등록부 — 실제 등록 내용과 무관하게 계약만 검증한다 */
const REGISTRY = [
    {
        advisory: FIX_ID,
        pkgs: ['fixture-root', 'fixture-root-dom'],
        severity: 'high' as const,
        scope: '픽스처 범위 설명 텍스트',
        reason: '테스트용 사유 텍스트 — 실제 위험 아님',
        revisitWhen: '테스트용 재검토 조건 텍스트',
    },
];

beforeEach(() => {
    resetAcceptedHits();
});

describe('extractGhsa', () => {
    it('advisory URL에서 GHSA ID를 뽑는다', () => {
        expect(extractGhsa(FIX_URL)).toBe(FIX_ID);
    });

    it('말단 슬래시가 있어도 뽑는다', () => {
        expect(extractGhsa(`${FIX_URL}/`)).toBe(FIX_ID);
    });

    it('GHSA 형식이 아닌 말단 세그먼트는 null', () => {
        expect(extractGhsa('https://example.com/advisories/not-an-id')).toBeNull();
        expect(extractGhsa('https://github.com/advisories/GHSA')).toBeNull();
    });

    it('문자열이 아니면 null', () => {
        expect(extractGhsa(undefined)).toBeNull();
        expect(extractGhsa(null)).toBeNull();
        expect(extractGhsa(123)).toBeNull();
    });
});

describe('isAccepted — 수용 차감', () => {
    it('등록된 권고(직접 via 객체)는 차감한다', () => {
        expect(isAccepted({ severity: 'high', via: [{ url: FIX_URL }] }, REGISTRY)).toBe(true);
    });

    it('등록된 근본 패키지의 전이 항목(문자열 via)도 차감한다', () => {
        // 전이 항목의 via는 ["<근본 패키지명>"] 형태로 온다
        expect(isAccepted({ severity: 'high', via: ['fixture-root'] }, REGISTRY)).toBe(true);
    });

    it('심각도가 같거나 낮으면 차감을 유지한다', () => {
        expect(isAccepted({ severity: 'high', via: [{ url: FIX_URL }] }, REGISTRY)).toBe(true);
        expect(isAccepted({ severity: 'moderate', via: [{ url: FIX_URL }] }, REGISTRY)).toBe(true);
    });

    it('차감 시 매칭 카운트를 기록한다 (stale 판정 근거)', () => {
        expect(getAcceptedHits(FIX_ID)).toBe(0);
        isAccepted({ severity: 'high', via: [{ url: FIX_URL }] }, REGISTRY);
        isAccepted({ severity: 'high', via: ['fixture-root'] }, REGISTRY);
        expect(getAcceptedHits(FIX_ID)).toBe(2);
    });

    it('차감되지 않은 경우 매칭 카운트를 올리지 않는다', () => {
        isAccepted({ severity: 'high', via: [{ url: FIX_URL }, { url: OTHER_URL }] }, REGISTRY);
        expect(getAcceptedHits(FIX_ID)).toBe(0);
    });
});

describe('isAccepted — fail-closed (게이트 우회 방지)', () => {
    it('미등록 권고는 차감하지 않는다', () => {
        expect(isAccepted({ severity: 'high', via: [{ url: OTHER_URL }] }, REGISTRY)).toBe(false);
    });

    it('미등록 패키지의 전이 항목은 차감하지 않는다', () => {
        expect(isAccepted({ severity: 'high', via: ['lodash'] }, REGISTRY)).toBe(false);
    });

    it('등록+미등록이 섞이면 차감하지 않는다', () => {
        expect(isAccepted({ severity: 'high', via: [{ url: FIX_URL }, { url: OTHER_URL }] }, REGISTRY)).toBe(false);
    });

    it('via가 없거나 비어 있으면 차감하지 않는다', () => {
        expect(isAccepted({ severity: 'high' }, REGISTRY)).toBe(false);
        expect(isAccepted({ severity: 'high', via: [] }, REGISTRY)).toBe(false);
    });

    it('info가 객체가 아니면 차감하지 않는다 (throw 없이)', () => {
        expect(isAccepted(null, REGISTRY)).toBe(false);
        expect(isAccepted(undefined, REGISTRY)).toBe(false);
        expect(isAccepted('high', REGISTRY)).toBe(false);
    });

    it('via 원소가 null이거나 url이 없으면 차감하지 않는다', () => {
        expect(isAccepted({ severity: 'high', via: [null] }, REGISTRY)).toBe(false);
        expect(isAccepted({ severity: 'high', via: [{}] }, REGISTRY)).toBe(false);
        expect(isAccepted({ severity: 'high', via: [123] }, REGISTRY)).toBe(false);
    });

    it('권고 ID가 URL의 부분 문자열로만 일치하면 차감하지 않는다 (정확 일치 강제)', () => {
        // includes 매칭이었다면 통과했을 형태들
        expect(isAccepted({ severity: 'high', via: [{ url: `${FIX_URL}-extra` }] }, REGISTRY)).toBe(false);
        expect(isAccepted({ severity: 'high', via: [{ url: `https://evil.example/${FIX_ID}x` }] }, REGISTRY)).toBe(false);
    });

    it('GHSA ID를 문자열 via로 넣어도 패키지명으로 매칭되지 않는다', () => {
        expect(isAccepted({ severity: 'high', via: [FIX_ID] }, REGISTRY)).toBe(false);
    });

    it('수용 시점보다 심각도가 높게 재평가되면 차감하지 않는다 (객체 via)', () => {
        expect(isAccepted({ severity: 'critical', via: [{ url: FIX_URL }] }, REGISTRY)).toBe(false);
    });

    it('전이 항목(문자열 via)도 심각도 상승 시 차감하지 않는다', () => {
        expect(isAccepted({ severity: 'critical', via: ['fixture-root'] }, REGISTRY)).toBe(false);
    });

    it('알 수 없는 심각도 문자열은 최고 등급으로 취급해 차감하지 않는다', () => {
        expect(isAccepted({ severity: 'CRITICAL', via: [{ url: FIX_URL }] }, REGISTRY)).toBe(false);
        expect(isAccepted({ severity: 'extreme', via: [{ url: FIX_URL }] }, REGISTRY)).toBe(false);
        expect(isAccepted({ severity: ' critical', via: [{ url: FIX_URL }] }, REGISTRY)).toBe(false);
    });

    it('빈 등록부에서는 아무것도 차감하지 않는다', () => {
        expect(isAccepted({ severity: 'high', via: [{ url: FIX_URL }] }, [])).toBe(false);
    });
});

describe('validateRegistry — 등록부 형식 강제 (오기입으로 게이트 무력화 방지)', () => {
    const base = REGISTRY[0];

    it('현재(실제) 등록부는 유효하다', () => {
        expect(validateRegistry()).toEqual([]);
    });

    it('픽스처 등록부도 유효하다', () => {
        expect(validateRegistry(REGISTRY)).toEqual([]);
    });

    it('빈 advisory를 거부한다 (전체 권고 차감 사고 방지)', () => {
        expect(validateRegistry([{ ...base, advisory: '' }])).not.toEqual([]);
    });

    it('접두사만 적은 advisory를 거부한다', () => {
        expect(validateRegistry([{ ...base, advisory: 'GHSA' }])).not.toEqual([]);
        expect(validateRegistry([{ ...base, advisory: 'advisories' }])).not.toEqual([]);
        expect(validateRegistry([{ ...base, advisory: 'GHSA-aaaa-bbbb' }])).not.toEqual([]);
    });

    it('pkgs가 비었거나 빈 문자열을 포함하면 거부한다', () => {
        expect(validateRegistry([{ ...base, pkgs: [] }])).not.toEqual([]);
        expect(validateRegistry([{ ...base, pkgs: ['  '] }])).not.toEqual([]);
    });

    it('구 형식(a / b)을 배열 원소로 재입력하면 거부한다', () => {
        expect(validateRegistry([{ ...base, pkgs: ['fixture-root / fixture-root-dom'] }])).not.toEqual([]);
    });

    it('스코프 패키지는 허용한다', () => {
        expect(validateRegistry([{ ...base, pkgs: ['@scope/name'] }])).toEqual([]);
    });

    it('유효하지 않은 severity를 거부한다', () => {
        expect(validateRegistry([{ ...base, severity: 'HIGH' as never }])).not.toEqual([]);
        expect(validateRegistry([{ ...base, severity: '' as never }])).not.toEqual([]);
    });

    it('근거 필드(reason·revisitWhen·scope) 누락을 거부한다', () => {
        expect(validateRegistry([{ ...base, reason: '' }])).not.toEqual([]);
        expect(validateRegistry([{ ...base, revisitWhen: '짧음' }])).not.toEqual([]);
        expect(validateRegistry([{ ...base, scope: '' }])).not.toEqual([]);
    });

    it('중복 등록을 거부한다', () => {
        expect(validateRegistry([base, { ...base }])).not.toEqual([]);
    });
});

describe('summarizeAudit — 리포트 형태 검증 (네트워크 장애 fail-open 차단)', () => {
    /** 유효한 audit 리포트 형태 */
    function report(vulns: Record<string, unknown>) {
        return JSON.stringify({
            auditReportVersion: 2,
            vulnerabilities: vulns,
            metadata: { vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0, info: 0, total: 0 } },
        });
    }

    it('심각도별로 집계한다', () => {
        const out = summarizeAudit(report({
            a: { severity: 'high', via: [{ url: OTHER_URL }] },
            b: { severity: 'moderate', via: [{ url: OTHER_URL }] },
        }));
        expect(out?.counts).toEqual({ critical: 0, high: 1, moderate: 1, low: 0 });
        expect(out?.accepted).toBe(0);
    });

    it('취약점이 없으면 0건으로 집계한다', () => {
        expect(summarizeAudit(report({}))?.counts).toEqual({ critical: 0, high: 0, moderate: 0, low: 0 });
    });

    it('레지스트리 오류 응답(exit 0 + error 객체)은 null — 0건으로 위장하지 않는다', () => {
        const registryError = JSON.stringify({
            message: 'request to https://registry.npmjs.org/... failed, reason: connect ECONNREFUSED',
            error: { code: 'ECONNREFUSED', summary: 'connect ECONNREFUSED', detail: '' },
        });
        expect(summarizeAudit(registryError)).toBeNull();
    });

    it('auditReportVersion이 없으면 null', () => {
        expect(summarizeAudit(JSON.stringify({ vulnerabilities: {}, metadata: { vulnerabilities: {} } }))).toBeNull();
    });

    it('metadata.vulnerabilities가 없으면 null', () => {
        expect(summarizeAudit(JSON.stringify({ auditReportVersion: 2, vulnerabilities: {} }))).toBeNull();
    });

    it('JSON이 깨졌거나 비었으면 null', () => {
        expect(summarizeAudit('')).toBeNull();
        expect(summarizeAudit('{ not json')).toBeNull();
        expect(summarizeAudit('null')).toBeNull();
    });
});
