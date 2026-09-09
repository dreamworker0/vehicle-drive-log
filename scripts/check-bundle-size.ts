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
//
// ⚠️ 측정 조건: 예산은 반드시 `.env`의 VITE_SENTRY_DSN에 값이 있는 상태로 실측해야 한다.
// DSN이 비면 Sentry SDK가 통째로 트리셰이킹되어 원시 기준 ~155KB 작게 나온다. CI는 secrets.ENV_FILE로
// 실제 DSN을 넣고 빌드하므로, DSN 없는 로컬 실측으로 예산을 잡으면 CI에서만 초과하는 상황이 생긴다.
// (2026-08-01 #107 머지 후 실제로 발생: 로컬 3092KB 통과 / CI 3249KB 초과)
// 게이트는 두 층이다 — **첫 로드**(사용자가 실제로 받는 것)와 **전체 합계**(코드량 드리프트).
//
// 2026-08-29 이전에는 전체 합계 하나만 있었고 그것을 "실사용자 다운로드 기준"이라고 적어 두었다.
// 실측해 보니 틀렸다: `dist/index.html`이 참조하는 것은 **145개 청크 중 2개**뿐이고 나머지는
// 전부 라우트별 지연 로드다. 전체 gzip 1048KB 중 첫 로드는 32KB — **3.1%**다.
// 그 결과 게이트가 사용자 체감이 아니라 저장소 전체 코드량을 재고 있었고, 정상적인 의존성
// 갱신마다 걸려 두 번 상향됐다(950→970→1050, 둘 다 Dependabot 묶음).
//
// 그래서 층을 나눈다. 첫 로드는 **좁게** 잡아 회귀를 실제로 잡고(엔트리에 무거운 라이브러리를
// 정적 import하면 즉시 터진다), 전체 합계는 **느슨하게** 잡아 큰 도약만 잡는다.
const BUDGETS = {
    // ── 첫 로드 게이트 — index.html이 참조하는 것만(script + modulepreload) ────────────
    // 실측(2026-08-29): 102.6KB 원시 / 32.0KB gzip = index 5.2KB + firebase-auth 97.4KB.
    // 대부분이 firebase-auth라 firebase 마이너 갱신이 주된 증가 요인이다. 여유는 그 몇 번을
    // 흡수할 만큼만 둔다 — 넓게 잡으면 recharts(418KB)를 엔트리에 끌어와도 안 걸린다.
    initialJs: 130 * 1024,      // 첫 로드 JS 원시: 130KB (실측 ~103KB)
    initialJsGzip: 42 * 1024,   // 첫 로드 JS gzip: 42KB (실측 ~32KB)

    // ── 전체 합계 — 드리프트 감시(느슨) ──────────────────────────────────────────────
    // 지연 로드분까지 전부 더한 값이라 사용자 다운로드량이 아니다. 새 무거운 라이브러리가
    // 통째로 들어오는 수준의 도약만 잡는 용도로 두고, 일상적 의존성 갱신은 통과시킨다.
    js: 3700 * 1024,        // JS 원시 전체: 3700KB (CI 실측 ~3338KB)
    jsGzip: 1160 * 1024,    // JS gzip 전체: 1160KB (CI 실측 ~1048KB)
                            //   2026-07-25 950→970 · 2026-08-01 970→1050 상향 이력은 모두
                            //   Dependabot 묶음이 1~수KB 넘겨 막힌 것이었다. 층을 나눈 뒤로는
                            //   이 값이 회귀 게이트가 아니므로 그 상향 압력이 사라진다.

    // ── CSS — 사실상 전량이 첫 로드다 ───────────────────────────────────────────────
    // index.html이 index-*.css를 stylesheet로 직접 걸고(171.5KB 원시 / 22.6KB gzip),
    // 라우트 전용은 OrgMapView 하나(15.2KB)뿐이다. 그래서 기존 전체 예산이 그대로
    // 첫 로드 게이트로 기능한다 — 별도 층을 두지 않는다.
    css: 200 * 1024,        // CSS 원시 전체: 200KB (실측 ~187KB)
    cssGzip: 35 * 1024,     // CSS gzip 전체: 35KB (실측 ~29KB)

    largestJs: 600 * 1024,  // 단일 최대 JS 청크 원시: 600KB (firebase-db ~548KB. 2026-08-01 firestore/storage
                            //   청크 분리로 582→560KB 확보 — 합쳐두면 다음 firebase 마이너에서 바로 터진다)

    // ── 프리캐시 전송량 — Hosting 대역폭의 직접 원인이다 ────────────────────────────
    // 서비스 워커가 **설치 즉시** 내려받는 양이다. 사용자가 화면을 하나도 열지 않아도,
    // 로그인을 하지 않아도 이만큼 나간다. 그래서 첫 로드 게이트와 별개로 필요하다 —
    // 2026-09-09 이전에는 첫 로드가 gzip 32KB인데 프리캐시가 148개 청크 1,010KB를
    // 끌어왔고, 두 게이트 어디에도 걸리지 않았다. 그것이 Hosting 월 26GB(무료 10GB)의
    // 정체였다(비로그인 방문 1회당 1.14MB × 하루 약 1,000회).
    // 실측(2026-09-09): 86.1KB = index.html 1.8 + index.js 2.6 + index.css 22.9
    //                            + firebase-auth 29.5 + 아이콘 3종 29.4.
    // 여유는 firebase-auth 마이너 갱신 몇 번을 흡수할 만큼만 둔다.
    precacheWire: 130 * 1024,
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

/**
 * 첫 로드에 실제로 내려가는 JS 파일명을 `dist/index.html`에서 뽑는다.
 *
 * 브라우저가 문서 파싱 중에 받는 것은 `<script src>`(엔트리)와 `<link rel="modulepreload">`
 * (엔트리의 **정적** import)뿐이다. Vite가 이 두 가지를 직접 써 주므로 별도 manifest 없이
 * 실제 워터폴과 일치한다. 라우트별 `import()`는 여기 나오지 않는다 — 그게 요점이다.
 *
 * **파일이 있는데 한 건도 못 뽑으면 fail-closed로 빌드를 실패시킨다**(호출부 참고). 산출물
 * 구조가 바뀌었는데 게이트만 조용히 사라지는 것이 이 검사가 막으려는 실패 그 자체이기
 * 때문이다 — `check-functions-env`가 README 블록을 못 찾을 때 통과시키지 않는 것과 같은 이유다.
 * 파일 자체가 없으면(빌드 전) `null`을 돌려 건너뛴다.
 */
function getInitialJsNames(): string[] | null {
    const indexHtml = path.resolve(__dirname, '..', 'dist', 'index.html');
    if (!fs.existsSync(indexHtml)) return null;

    const html = fs.readFileSync(indexHtml, 'utf8');
    const names = new Set<string>();
    // <script ... src="/assets/x.js"> 와 <link rel="modulepreload" ... href="/assets/y.js">
    for (const m of html.matchAll(/<script[^>]+src="\/assets\/([^"]+\.js)"/g)) names.add(m[1]);
    for (const m of html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\/assets\/([^"]+\.js)"/g)) names.add(m[1]);
    return [...names];
}

/** `dist/index.html`이 참조하는 셸 자산을 프리캐시 매니페스트와 같은 표기(`assets/x.js`)로 뽑는다. */
function getShellAssetPaths(): string[] | null {
    const indexHtml = path.resolve(__dirname, '..', 'dist', 'index.html');
    if (!fs.existsSync(indexHtml)) return null;

    const html = fs.readFileSync(indexHtml, 'utf8');
    const names = new Set<string>();
    for (const m of html.matchAll(/<script[^>]+src="\/(assets\/[^"]+)"/g)) names.add(m[1]);
    for (const m of html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\/(assets\/[^"]+)"/g)) names.add(m[1]);
    for (const m of html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="\/(assets\/[^"]+)"/g)) names.add(m[1]);

    return [...names];
}

/**
 * 생성된 `dist/sw.js`에서 프리캐시 매니페스트를 뽑는다.
 *
 * `injectManifest` 전략이라 `self.__WB_MANIFEST`가 빌드 시 `{revision,url}` 배열로 치환되고,
 * sw.js는 번들·최소화되어 `precacheAndRoute` 식별자가 남지 않는다. 그래서 **함수명이 아니라
 * 배열 리터럴의 모양**으로 찾는다. 항목마다 `revision` 키가 먼저 오는 것은 workbox가
 * 생성하는 형태다.
 */
function getPrecacheManifest(): Array<{ url: string; revision: string | null }> | null {
    const swPath = path.resolve(__dirname, '..', 'dist', 'sw.js');
    if (!fs.existsSync(swPath)) return null;

    const sw = fs.readFileSync(swPath, 'utf8');
    const m = sw.match(/\[\{"revision":[\s\S]*?\}\]/);
    if (!m) return null;
    try {
        return JSON.parse(m[0]);
    } catch {
        return null;
    }
}

/** 실제로 회선을 타는 크기 — 압축 가능한 텍스트는 gzip, 이미지 등은 원시 크기다. */
function wireSize(relUrl: string): number | null {
    const filePath = path.resolve(__dirname, '..', 'dist', relUrl);
    if (!fs.existsSync(filePath)) return null;
    const buf = fs.readFileSync(filePath);
    return /\.(js|css|html|svg|json)$/i.test(relUrl) ? gzipSync(buf).length : buf.length;
}

/**
 * 프리캐시 게이트 — 두 방향의 회귀를 모두 막는다.
 *
 *  1. **부풀기**: 전송 합계가 예산을 넘으면 실패. Hosting 대역폭이 곧바로 늘어난다.
 *  2. **셸 유실**: index.html과 그것이 참조하는 자산이 매니페스트에서 빠지면 실패.
 *     vite.config.js의 globPatterns가 엔트리 파일명과 어긋나면 프리캐시가 조용히 비고
 *     **오프라인이 통째로 죽는다** — 그 실패는 배포 후 현장에서야 드러난다.
 *
 * @returns 경고가 발생했으면 true
 */
function checkPrecache(): boolean {
    const shell = getShellAssetPaths();
    if (shell === null) {
        console.log('\n⚠️  dist/index.html이 없어 프리캐시 게이트를 건너뜁니다 (빌드 전 실행).');
        return false;
    }

    const manifest = getPrecacheManifest();
    if (manifest === null) {
        // fail-closed — sw.js가 있어야 할 시점에 없거나 형태가 바뀐 것이다.
        console.log('\n❌ dist/sw.js에서 프리캐시 매니페스트를 읽지 못했습니다.');
        console.log('   vite-plugin-pwa의 산출물 형태가 바뀌었다면 getPrecacheManifest()를 함께 갱신하세요.');
        return true;
    }

    console.log(`\n📥 프리캐시 (${manifest.length}개 — SW 설치 즉시 내려받는 양)`);

    let hasWarning = false;
    let wireTotal = 0;
    for (const entry of manifest) {
        const size = wireSize(entry.url);
        if (size === null) {
            console.log(`   ❌ 매니페스트가 가리키는 파일이 없습니다: ${entry.url}`);
            hasWarning = true;
            continue;
        }
        wireTotal += size;
        console.log(`   ${formatSize(size).padStart(10)}  ${entry.url}`);
    }

    // fail-closed — 세 추출 중 **CSS만** 깨져도 조용히 지나가면 안 된다. 그때 shell에는
    // script·modulepreload 항목이 남아 `missing`이 비고, CSS가 프리캐시에서 빠지는 회귀를
    // 그대로 통과시킨다(오프라인에서 스타일 없는 화면). index.html은 항상 index-*.css를
    // stylesheet로 직접 걸므로 0건은 추출 규칙이 죽었다는 뜻이다.
    if (!shell.some(p => p.endsWith('.css'))) {
        console.log('   ❌ dist/index.html에서 셸 스타일시트를 한 건도 찾지 못했습니다.');
        console.log('      → getShellAssetPaths()의 추출 규칙을 산출물 구조에 맞게 갱신하세요.');
        hasWarning = true;
    }

    // 셸 유실 검사 — index.html과 그 참조 자산이 전부 들어 있어야 한다.
    const urls = new Set(manifest.map(e => e.url));
    const missing = ['index.html', ...shell].filter(p => !urls.has(p));
    if (missing.length > 0) {
        console.log(`   ❌ 앱 셸이 프리캐시에서 빠졌습니다: ${missing.join(', ')}`);
        console.log('      → 오프라인이 동작하지 않습니다. vite.config.js의 globPatterns를 확인하세요.');
        hasWarning = true;
    }

    /*
     * 역방향 검사 — 프리캐시의 `/assets/` 항목은 index.html이 참조하는 것과 **정확히 같아야**
     * 한다. `assets/index-*`는 엔트리 파일명 규칙이 아니라 접두사 패턴이라, 앞으로
     * `index.ts(x)` 모듈에서 갈라진 라우트 청크가 같은 접두사를 가지면 의도 없이 프리캐시에
     * 들어온다. 전송 예산은 큰 유입만 잡고 작은 청크는 조용히 통과시키므로, 프리캐시를
     * 셸로 한정한 취지가 조금씩 침식된다. 여기서 집합으로 못박는다.
     */
    const shellSet = new Set(shell);
    const unexpected = manifest
        .map(e => e.url)
        .filter(u => u.startsWith('assets/') && !shellSet.has(u));
    if (unexpected.length > 0) {
        console.log(`   ❌ index.html이 참조하지 않는 청크가 프리캐시에 있습니다: ${unexpected.join(', ')}`);
        console.log('      → 라우트 청크는 sw.ts의 /assets/ 런타임 캐시가 담아야 합니다. globPatterns를 확인하세요.');
        hasWarning = true;
    }

    if (wireTotal > BUDGETS.precacheWire) {
        console.log(`   ⚠️  프리캐시 전송 예산 초과! (${formatSize(wireTotal)} / ${formatSize(BUDGETS.precacheWire)})`);
        console.log('      → 라우트 청크는 프리캐시가 아니라 sw.ts의 /assets/ 런타임 캐시가 담아야 합니다.');
        hasWarning = true;
    } else {
        console.log(`   ✅ 프리캐시 전송 예산 이내 (${formatSize(wireTotal)} / ${formatSize(BUDGETS.precacheWire)})`);
    }

    return hasWarning;
}

function main(): void {
    console.log('\n📦 번들 크기 리포트');
    console.log('─'.repeat(60));

    const files = getFileSizes(DIST_DIR);
    let hasWarning = false;

    // ── 첫 로드 게이트 — 사용자가 문서 파싱 중에 실제로 받는 것만 ──────────────────
    // 전체 합계와 달리 이 값이 커지면 그대로 첫 화면이 느려진다. 여기가 진짜 회귀 게이트다.
    const initialNames = getInitialJsNames();
    const initialFiles = initialNames === null ? [] : files.js.filter(f => initialNames.includes(f.name));
    if (initialNames === null) {
        console.log('\n⚠️  dist/index.html이 없어 첫 로드 게이트를 건너뜁니다 (빌드 전 실행).');
    } else if (initialFiles.length === 0) {
        // fail-closed — 게이트가 조용히 비활성화되는 것을 허용하지 않는다.
        console.log('\n❌ dist/index.html에서 첫 로드 JS를 한 건도 찾지 못했습니다.');
        console.log('   빌드 산출물 구조가 바뀌었다면 getInitialJsNames()의 추출 규칙을 함께 갱신하세요.');
        hasWarning = true;
    } else {
        const initialRaw = initialFiles.reduce((sum, f) => sum + f.size, 0);
        const initialGzip = initialFiles.reduce((sum, f) => sum + f.gzipSize, 0);
        console.log(`\n🚀 첫 로드 JS (${initialFiles.length}개 — index.html 참조분)`);
        initialFiles
            .sort((a, b) => b.size - a.size)
            .forEach(f => console.log(`   ${f.sizeKB.padStart(8)} KB  ${f.name}`));

        if (initialRaw > BUDGETS.initialJs) {
            console.log(`   ⚠️  첫 로드 JS 원시 예산 초과! (${formatSize(initialRaw)} / ${formatSize(BUDGETS.initialJs)})`);
            hasWarning = true;
        } else {
            console.log(`   ✅ 첫 로드 JS 원시 예산 이내 (${formatSize(initialRaw)} / ${formatSize(BUDGETS.initialJs)})`);
        }

        if (initialGzip > BUDGETS.initialJsGzip) {
            console.log(`   ⚠️  첫 로드 JS gzip 예산 초과! (${formatSize(initialGzip)} / ${formatSize(BUDGETS.initialJsGzip)})`);
            hasWarning = true;
        } else {
            console.log(`   ✅ 첫 로드 JS gzip 예산 이내 (${formatSize(initialGzip)} / ${formatSize(BUDGETS.initialJsGzip)})`);
        }
    }

    // ── 프리캐시 게이트 — SW 설치 즉시 나가는 양(Hosting 대역폭의 직접 원인) ──────────
    if (checkPrecache()) hasWarning = true;

    // JS 리포트 — 아래는 지연 로드까지 전부 더한 값이다(드리프트 감시). 사용자 다운로드량이 아니다.
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
