/**
 * E2E 실패 증거가 서로를 지우지 않는지 고정
 *
 * Playwright는 실행 시작 시 자기 `outputDir`를 지운다. 비인증 E2E와 인증 E2E가
 * 기본값(`test-results/`)을 공유하면, 뒤에 도는 인증 E2E가 앞선 실패의 스크린샷·trace를
 * 통째로 지워 업로드 스텝이 "No files were found"로 끝난다.
 * **정작 실패했을 때만 증거가 사라지는** 형태라 조용히 넘어가기 쉽다.
 *
 * Phase 136에서 두 E2E가 서로의 실패에 묶이지 않고 각자 결론을 내게 되면서 드러났다
 * (그전에는 앞이 실패하면 뒤가 skipped라 지워질 일이 없었다).
 *
 * 실제 삭제 동작은 Playwright를 두 번 돌려 확인했다. 여기서는 그 전제인
 * "두 설정의 outputDir이 다르고, 둘 다 업로드 경로 안에 있다"를 고정한다.
 */
import { describe, it, expect } from 'vitest';

import playwrightConfig from '../../playwright.config.js?raw';
import emulatorConfig from '../../playwright.emulator.config.ts?raw';
import ciWorkflow from '../../.github/workflows/ci.yml?raw';

/** `outputDir: 'test-results/e2e',` 에서 경로만 뽑는다 */
function outputDirOf(source: string): string | null {
    const m = source.match(/outputDir:\s*['"]([^'"]+)['"]/);
    return m ? m[1] : null;
}

/** ci.yml의 E2E 실패 아티팩트 업로드 스텝이 수집하는 경로들 */
function uploadPaths(workflow: string): string[] {
    const m = workflow.match(/name: Upload E2E failure artifacts[\s\S]*?path:\s*\|([\s\S]*?)\n\s{10}\S/);
    if (!m) throw new Error('업로드 스텝의 path 블록을 찾지 못했다');
    return m[1].split('\n').map((l) => l.trim()).filter(Boolean);
}

describe('E2E 아티팩트 격리', () => {
    const e2e = outputDirOf(playwrightConfig);
    const authed = outputDirOf(emulatorConfig);

    it('두 설정 모두 outputDir을 명시한다', () => {
        // 하나라도 기본값으로 돌아가면 다시 같은 폴더를 공유하게 된다
        expect(e2e, 'playwright.config.js에 outputDir이 없다').toBeTruthy();
        expect(authed, 'playwright.emulator.config.ts에 outputDir이 없다').toBeTruthy();
    });

    it('두 outputDir이 서로 다르다', () => {
        expect(e2e).not.toBe(authed);
    });

    it('한쪽이 다른 쪽을 포함하지 않는다', () => {
        // 상위 폴더를 outputDir로 잡으면 하위까지 함께 지워진다
        expect(`${e2e}/`.startsWith(`${authed}/`), `${e2e}가 ${authed} 안에 있다`).toBe(false);
        expect(`${authed}/`.startsWith(`${e2e}/`), `${authed}가 ${e2e} 안에 있다`).toBe(false);
    });

    it('두 폴더 모두 CI 업로드 경로 안에 있다', () => {
        // 격리에 성공해도 업로드 경로 밖이면 결국 증거를 못 본다
        const paths = uploadPaths(ciWorkflow);
        expect(paths.length, 'ci.yml 업로드 경로를 못 읽었다').toBeGreaterThan(0);

        for (const dir of [e2e, authed]) {
            const covered = paths.some((p) => `${dir}/`.startsWith(p.replace(/\/?$/, '/')));
            expect(covered, `${dir}가 ci.yml 업로드 경로(${paths.join(', ')})에 안 걸린다`).toBe(true);
        }
    });
});
