/**
 * 번들 크기 모니터링 스크립트
 * 빌드 후 dist/assets/ 내 JS/CSS 파일 크기를 합산하여 예산 초과 시 경고
 *
 * 사용법: node scripts/check-bundle-size.js (postbuild에서 자동 실행)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '..', 'dist', 'assets');

// 예산 설정 (바이트)
const BUDGETS = {
    js: 2500 * 1024,  // JS 전체: 2500KB (code-split 청크 포함)
    css: 100 * 1024,  // CSS 전체: 100KB
};

interface FileInfo {
    name: string;
    size: number;
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

        if (ext === '.js') {
            result.js.push({ name: file, size: stat.size, sizeKB });
        } else if (ext === '.css') {
            result.css.push({ name: file, size: stat.size, sizeKB });
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
    console.log(`\n📄 JavaScript (${files.js.length}개 파일)`);
    files.js
        .sort((a, b) => b.size - a.size)
        .forEach(f => console.log(`   ${f.sizeKB.padStart(8)} KB  ${f.name}`));
    console.log(`   ${'─'.repeat(10)}`);
    console.log(`   ${formatSize(jsTotal).padStart(8)}     Total JS`);

    if (jsTotal > BUDGETS.js) {
        console.log(`   ⚠️  JS 예산 초과! (${formatSize(jsTotal)} / ${formatSize(BUDGETS.js)})`);
        hasWarning = true;
    } else {
        console.log(`   ✅ JS 예산 이내 (${formatSize(jsTotal)} / ${formatSize(BUDGETS.js)})`);
    }

    // CSS 리포트
    const cssTotal = files.css.reduce((sum, f) => sum + f.size, 0);
    console.log(`\n🎨 CSS (${files.css.length}개 파일)`);
    files.css
        .sort((a, b) => b.size - a.size)
        .forEach(f => console.log(`   ${f.sizeKB.padStart(8)} KB  ${f.name}`));
    console.log(`   ${'─'.repeat(10)}`);
    console.log(`   ${formatSize(cssTotal).padStart(8)}     Total CSS`);

    if (cssTotal > BUDGETS.css) {
        console.log(`   ⚠️  CSS 예산 초과! (${formatSize(cssTotal)} / ${formatSize(BUDGETS.css)})`);
        hasWarning = true;
    } else {
        console.log(`   ✅ CSS 예산 이내 (${formatSize(cssTotal)} / ${formatSize(BUDGETS.css)})`);
    }

    // 합계
    const total = jsTotal + cssTotal;
    console.log(`\n📊 총 번들 크기: ${formatSize(total)}`);
    console.log('─'.repeat(60));

    if (hasWarning) {
        console.log('⚠️  예산을 초과한 항목이 있습니다. 번들 최적화를 검토하세요.\n');
    } else {
        console.log('✅ 모든 번들 크기가 예산 이내입니다.\n');
    }
}

main();
