/**
 * 번들 크기 모니터링 스크립트
 * 빌드 후 dist/assets/ 내 JS/CSS 파일 크기를 합산하여 예산 초과 시 경고
 *
 * 사용법: node scripts/check-bundle-size.js (postbuild에서 자동 실행)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { gzipSync } from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '..', 'dist', 'assets');

// 예산 설정 (바이트).
// 원시(raw)는 다운로드 후 파싱/실행 비용, gzip은 실제 전송량을 각각 대변한다.
// 둘 다 하드 게이트 — 어느 하나라도 넘으면 빌드를 실패시켜 회귀를 막는다.
const BUDGETS = {
    js: 3000 * 1024,        // JS 원시 전체: 3000KB (code-split 청크 포함)
    css: 200 * 1024,        // CSS 원시 전체: 200KB
    jsGzip: 950 * 1024,     // JS gzip 전체: 950KB (실측 ~917KB)
    cssGzip: 35 * 1024,     // CSS gzip 전체: 35KB (실측 ~29KB)
    largestJs: 420 * 1024,  // 단일 최대 JS 청크 원시: 420KB (실측 recharts ~399KB)
};

interface FileInfo {
    name: string;
    size: number;
    gzipSize: number;
    sizeKB: string;
}

function getFileSizes(dir: string): { js: FileInfo[]; css: FileInfo[] } {
    const result: { js: FileInfo[]; css: FileInfo[] } = { js: [], css: [] };

    if (!fs.existsSync(dir)) {
        console.warn('⚠️  dist/assets 디렉터리가 없습니다. 먼저 빌드를 실행하세요.');
        process.exit(0);
    }

    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) continue;

        const ext = path.extname(file).toLowerCase();
        const sizeKB = (stat.size / 1024).toFixed(1);

        if (ext === '.js' || ext === '.css') {
            const gzipSize = gzipSync(fs.readFileSync(filePath)).length;
            const info: FileInfo = { name: file, size: stat.size, gzipSize, sizeKB };
            if (ext === '.js') result.js.push(info);
            else result.css.push(info);
        }
    }

    return result;
}

function formatSize(bytes: number): string {
    return (bytes / 1024).toFixed(1) + ' KB';
}

function main(): void {
    console.log('\n📦 번들 크기 리포트');
    console.log('─'.repeat(60));

    const files = getFileSizes(DIST_DIR);
    let hasWarning = false;

    // JS 리포트
    const jsTotal = files.js.reduce((sum, f) => sum + f.size, 0);
    const jsGzipTotal = files.js.reduce((sum, f) => sum + f.gzipSize, 0);
    console.log(`\n📄 JavaScript (${files.js.length}개 파일)`);
    files.js
        .sort((a, b) => b.size - a.size)
        .forEach(f => console.log(`   ${f.sizeKB.padStart(8)} KB  ${f.name}`));
    console.log(`   ${'─'.repeat(10)}`);
    console.log(`   ${formatSize(jsTotal).padStart(8)}     Total JS (원시)`);
    console.log(`   ${formatSize(jsGzipTotal).padStart(8)}     Total JS (gzip)`);

    if (jsTotal > BUDGETS.js) {
        console.log(`   ⚠️  JS 원시 예산 초과! (${formatSize(jsTotal)} / ${formatSize(BUDGETS.js)})`);
        hasWarning = true;
    } else {
        console.log(`   ✅ JS 원시 예산 이내 (${formatSize(jsTotal)} / ${formatSize(BUDGETS.js)})`);
    }

    if (jsGzipTotal > BUDGETS.jsGzip) {
        console.log(`   ⚠️  JS gzip 예산 초과! (${formatSize(jsGzipTotal)} / ${formatSize(BUDGETS.jsGzip)})`);
        hasWarning = true;
    } else {
        console.log(`   ✅ JS gzip 예산 이내 (${formatSize(jsGzipTotal)} / ${formatSize(BUDGETS.jsGzip)})`);
    }

    // 단일 최대 JS 청크 게이트 — 특정 청크가 비대해지는 회귀를 개별로 차단한다.
    const largestJs = files.js.reduce<FileInfo | null>((max, f) => (!max || f.size > max.size ? f : max), null);
    if (largestJs) {
        if (largestJs.size > BUDGETS.largestJs) {
            console.log(`   ⚠️  최대 JS 청크 초과! ${largestJs.name} (${formatSize(largestJs.size)} / ${formatSize(BUDGETS.largestJs)})`);
            hasWarning = true;
        } else {
            console.log(`   ✅ 최대 JS 청크 이내: ${largestJs.name} (${formatSize(largestJs.size)} / ${formatSize(BUDGETS.largestJs)})`);
        }
    }

    // CSS 리포트
    const cssTotal = files.css.reduce((sum, f) => sum + f.size, 0);
    const cssGzipTotal = files.css.reduce((sum, f) => sum + f.gzipSize, 0);
    console.log(`\n🎨 CSS (${files.css.length}개 파일)`);
    files.css
        .sort((a, b) => b.size - a.size)
        .forEach(f => console.log(`   ${f.sizeKB.padStart(8)} KB  ${f.name}`));
    console.log(`   ${'─'.repeat(10)}`);
    console.log(`   ${formatSize(cssTotal).padStart(8)}     Total CSS (원시)`);
    console.log(`   ${formatSize(cssGzipTotal).padStart(8)}     Total CSS (gzip)`);

    if (cssTotal > BUDGETS.css) {
        console.log(`   ⚠️  CSS 원시 예산 초과! (${formatSize(cssTotal)} / ${formatSize(BUDGETS.css)})`);
        hasWarning = true;
    } else {
        console.log(`   ✅ CSS 원시 예산 이내 (${formatSize(cssTotal)} / ${formatSize(BUDGETS.css)})`);
    }

    if (cssGzipTotal > BUDGETS.cssGzip) {
        console.log(`   ⚠️  CSS gzip 예산 초과! (${formatSize(cssGzipTotal)} / ${formatSize(BUDGETS.cssGzip)})`);
        hasWarning = true;
    } else {
        console.log(`   ✅ CSS gzip 예산 이내 (${formatSize(cssGzipTotal)} / ${formatSize(BUDGETS.cssGzip)})`);
    }

    // 합계
    const total = jsTotal + cssTotal;
    console.log(`\n📊 총 번들 크기: ${formatSize(total)}`);
    console.log('─'.repeat(60));

    if (hasWarning) {
        console.log('❌ 예산을 초과한 항목이 있습니다. 번들 최적화를 검토하세요.\n');
        // 예산은 게이트다 — postbuild·CI에서 초과 시 빌드를 실패시켜 회귀를 막는다.
        process.exit(1);
    } else {
        console.log('✅ 모든 번들 크기가 예산 이내입니다.\n');
    }
}

main();
