/**
 * e2e/emulator/global-setup.ts — Playwright globalSetup.
 * 인증 E2E 실행 전에 에뮬레이터에 테스트 데이터를 시드한다.
 */
import { seedEmulator } from './seed';

async function globalSetup() {
    await seedEmulator();
    console.log('[E2E] 에뮬레이터 시드 완료');
}

export default globalSetup;
