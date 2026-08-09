/**
 * E2E 프리플라이트 — Playwright 브라우저 설치 여부 검사
 *
 * `npm run test:e2e` 직전(pretest:e2e)에 자동 실행된다. 브라우저가 없으면
 * Playwright의 모호한 "Executable doesn't exist" 런타임 에러 대신, 설치 명령을
 * 안내하고 명확히 종료한다. 네트워크 다운로드는 하지 않는다(설치 여부만 확인).
 *
 * Chromium만 보던 검사에 **WebKit을 더한다** — `test:e2e`가 mobile-safari 프로젝트를
 * 포함하게 되면서, WebKit이 없으면 스펙 전체가 "Executable doesn't exist"로 무더기
 * 실패한다. 그 상태의 빨간불은 앱 회귀와 구분되지 않는다.
 *
 * 사용법: tsx scripts/check-e2e-ready.ts
 */
import fs from 'fs';
import { chromium, webkit } from '@playwright/test';

/** 설치되어 있으면 true. 실행 파일 경로를 알 수 없는 경우도 미설치로 본다. */
function isInstalled(browserType: { executablePath: () => string }): boolean {
    try {
        const execPath = browserType.executablePath();
        return !!execPath && fs.existsSync(execPath);
    } catch {
        return false;
    }
}

function main() {
    const missing = [
        { name: 'chromium', ok: isInstalled(chromium) },
        { name: 'webkit', ok: isInstalled(webkit) },
    ].filter(b => !b.ok).map(b => b.name);

    if (missing.length === 0) {
        // 설치 확인됨 — 조용히 통과
        return;
    }

    const list = missing.join(' ');
    console.error(`\n❌ Playwright 브라우저(${list})가 설치되어 있지 않습니다.`);
    console.error('   E2E 테스트 실행 전 1회 설치가 필요합니다:\n');
    console.error(`     npx playwright install ${list}`);
    console.error(`   (CI/리눅스에서 OS 의존성까지: npx playwright install --with-deps ${list})\n`);
    console.error('   ⚠️ 이는 앱 코드 실패가 아니라 로컬 환경 미설치입니다.');
    console.error('   WebKit은 iOS Safari 검증(mobile-safari 프로젝트)에 필요합니다.\n');
    process.exit(1);
}

main();
