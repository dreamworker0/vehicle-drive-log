/**
 * PWA 스크린샷 생성 스크립트
 * Playwright로 랜딩 페이지를 캡처하여 manifest.json 스크린샷으로 사용
 *
 * 사용법: node scripts/generate-screenshots.js
 * 전제: 개발 서버가 localhost:5173에서 실행 중이어야 함
 */
import { chromium, Page } from '@playwright/test';
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = path.resolve(__dirname, '..', 'public', 'icons');
const BASE_URL = 'http://localhost:5173';

async function captureScreenshot(page: Page, viewport: { width: number; height: number }, outputName: string): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  // 애니메이션이 끝날 때까지 대기
  await page.waitForTimeout(1500);

  const pngBuffer = await page.screenshot({ type: 'png', fullPage: false });

  // sharp로 WebP 변환 + 최적화
  const outputPath = path.join(ICONS_DIR, outputName);
  await sharp(pngBuffer)
    .webp({ quality: 85 })
    .toFile(outputPath);

  const stats = await import('fs').then(fs => fs.statSync(outputPath));
  console.log(`✅ ${outputName} 생성 완료 (${(stats.size / 1024).toFixed(1)} KB)`);
}

async function main(): Promise<void> {
  console.log('📸 PWA 스크린샷 생성 시작...\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'ko-KR',
    colorScheme: 'light',
  });
  const page = await context.newPage();

  try {
    // 모바일 스크린샷 (390×844 — iPhone 14 기준)
    await captureScreenshot(page, { width: 390, height: 844 }, 'screenshot-mobile.webp');

    // 데스크톱 스크린샷 (1280×800)
    await captureScreenshot(page, { width: 1280, height: 800 }, 'screenshot-desktop.webp');

    console.log('\n🎉 모든 스크린샷 생성 완료!');
  } catch (err: any) {
    console.error('❌ 스크린샷 생성 실패:', err.message);
    console.error('   → 개발 서버가 http://localhost:5173 에서 실행 중인지 확인하세요.');
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
