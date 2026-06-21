/**
 * E2E 프리플라이트 — Playwright 브라우저(Chromium) 설치 여부 검사
 *
 * `npm run test:e2e` 직전(pretest:e2e)에 자동 실행된다. 브라우저가 없으면
 * Playwright의 모호한 "Executable doesn't exist" 런타임 에러 대신, 설치 명령을
 * 안내하고 명확히 종료한다. 네트워크 다운로드는 하지 않는다(설치 여부만 확인).
 *
 * 사용법: tsx scripts/check-e2e-ready.ts
 */
import fs from 'fs';
import { chromium } from '@playwright/test';

function main() {
    let execPath: string | undefined;
    try {
        execPath = chromium.executablePath();
    } catch {
        execPath = undefined;
    }

    if (execPath && fs.existsSync(execPath)) {
        // 설치 확인됨 — 조용히 통과
        return;
    }

    console.error('\n❌ Playwright 브라우저(Chromium)가 설치되어 있지 않습니다.');
    console.error('   E2E 테스트 실행 전 1회 설치가 필요합니다:\n');
    console.error('     npx playwright install chromium');
    console.error('   (CI/리눅스에서 OS 의존성까지: npx playwright install --with-deps chromium)\n');
    console.error('   ⚠️ 이는 앱 코드 실패가 아니라 로컬 환경 미설치입니다.\n');
    process.exit(1);
}

main();
