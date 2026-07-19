import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(SCRIPT_PATH), '..');
const SOURCE_PATH = path.join(
  ROOT_DIR,
  'docs',
  'diagrams',
  'vehicle-drive-log-organization-journey.html',
);
export const DEFAULT_OUTPUT_PATH = path.join(
  ROOT_DIR,
  'docs',
  'images',
  'vehicle-drive-log-organization-journey.png',
);

export async function renderOrganizationJourney(
  outputPath = DEFAULT_OUTPUT_PATH,
): Promise<void> {
  const html = await readFile(SOURCE_PATH, 'utf8');
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 1,
      colorScheme: 'light',
      locale: 'ko-KR',
    });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const board = page.locator('.perspective-board');
    await board.waitFor({ state: 'visible' });
    const capture = await board.screenshot({ type: 'png' });

    await sharp(capture)
      .resize(3200, 1800, {
        fit: 'contain',
        background: '#f8fbfe',
        position: 'centre',
      })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(outputPath);
  } finally {
    await browser.close();
  }

  const metadata = await sharp(outputPath).metadata();
  if (
    metadata.format !== 'png' ||
    metadata.width !== 3200 ||
    metadata.height !== 1800
  ) {
    throw new Error(
      `Unexpected diagram output: ${metadata.format} ${metadata.width}x${metadata.height}`,
    );
  }
}

const isDirectRun =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === SCRIPT_PATH;

if (isDirectRun) {
  renderOrganizationJourney().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
