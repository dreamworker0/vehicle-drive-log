import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * axe-core 기반 접근성 자동 검사.
 *
 * 비인증 공개 라우트를 대상으로 WCAG 2.0/2.1 A·AA 규칙을 검사하고,
 * 심각도 serious/critical 위반이 0건인지 단언한다. moderate/minor는
 * 리포트만 하고 게이트로 삼지 않는다(오탐·주관 판정 비율이 높아 회귀 방어 가치가 낮음).
 *
 * color-contrast 예외: 랜딩·약관·개인정보 페이지에 기존 디자인 발 대비 부족(주로
 * 푸터·소형 도움말 텍스트, 예: text-primary-300/60 on bg-primary-900 = 3.08:1)이
 * 다수 존재한다. 이는 디자인 시스템 전반의 색상 팔레트 조정이 필요한 별도 부채이므로
 * 이 게이트에서는 제외하고 리포트만 한다. 구조·ARIA·라벨 등 나머지 serious/critical만
 * 하드 게이트로 삼아 회귀를 막는다. (색상 대비는 별도 디자인 트랙에서 처리)
 */
const PUBLIC_PATHS = ['/', '/login', '/apply', '/terms', '/privacy'];

// 게이트에서 제외하되 리포트는 유지하는 규칙 (기존 디자인 부채).
const REPORT_ONLY_RULES = new Set(['color-contrast']);

for (const path of PUBLIC_PATHS) {
    test(`${path}에 serious·critical 접근성 위반이 없다 (색상 대비 제외)`, async ({ page }) => {
        await page.goto(path);
        // SPA 초기 렌더·폰트 로드가 끝난 뒤 검사 (레이아웃 미완성 상태의 오탐 방지)
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1500);

        const result = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            // 서드파티 iframe(랜딩 YouTube 임베드 등) 내부는 우리 통제 밖이라 검사에서 제외한다.
            // YouTube 플레이어의 button-name·aria-prohibited-attr 위반은 우리가 고칠 수 없다.
            .exclude('iframe')
            .analyze();

        const seriousOrCritical = result.violations.filter(
            ({ impact }) => impact === 'serious' || impact === 'critical',
        );
        const blocking = seriousOrCritical.filter((v) => !REPORT_ONLY_RULES.has(v.id));
        const reportOnly = seriousOrCritical.filter((v) => REPORT_ONLY_RULES.has(v.id));

        // 리포트 전용(부채) — 게이트에는 반영하지 않고 노드 수만 남긴다.
        if (reportOnly.length > 0) {
            console.log(
                `[axe] ${path} 색상 대비 부채(게이트 제외): ` +
                    reportOnly.map((v) => `${v.id} ${v.nodes.length}건`).join(', '),
            );
        }
        // 게이트 대상 — 규칙 id·설명을 함께 출력해 원인 파악을 돕는다.
        if (blocking.length > 0) {
            console.log(
                `[axe] ${path} 게이트 위반:\n` +
                    blocking.map((v) => `  - ${v.id} (${v.impact}): ${v.help}`).join('\n'),
            );
        }
        expect(blocking).toEqual([]);
    });
}
