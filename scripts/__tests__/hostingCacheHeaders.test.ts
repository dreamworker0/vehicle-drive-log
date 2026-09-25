/**
 * Hosting 캐시 헤더 — 서비스 워커 스크립트는 **매번 확인하되, 바뀌지 않았으면 다시 받지 않는다.**
 *
 * 왜 필요한가 — 2026-09-25 결제 SKU 점검에서 Hosting 전송량이 30일 23.7 GiB(무료 10 GiB의
 * 2.4배, 전체 요금의 18%)였다. 원인은 `sw.js`(압축 후 약 180 KB)였다. 앱은 10분마다, 그리고
 * 탭으로 돌아올 때마다 `registration.update()`로 새 버전을 확인한다(main.tsx·UpdatePrompt).
 * 헤더가 `no-cache, no-store, must-revalidate`라서 브라우저가 응답을 저장하지 못했고, 그래서
 * 확인할 때마다 조건부 요청 없이 전체를 다시 받았다. 실측으로 같은 CDN의 다른 파일은 ETag로
 * 304(0 바이트)를 돌려주는데 `sw.js`만 매번 200 전체였다.
 *
 * `no-cache`만 두면 브라우저는 저장한 뒤 **매번 서버에 재검증**한다. 갱신 확인이 늦어지지 않고
 * (새 배포는 ETag가 달라 즉시 200), 바뀌지 않았으면 304로 끝난다. `no-store`는 이 재검증 경로를
 * 없애기만 하고 얻는 것이 없다 — 되살리면 조용히 전송량만 늘어나므로 정적으로 못박는다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface HeaderRule { source: string; headers: { key: string; value: string }[] }

const firebaseJson = JSON.parse(readFileSync(resolve(ROOT, 'firebase.json'), 'utf8')) as {
    hosting: { headers: HeaderRule[] } | { headers: HeaderRule[] }[];
};
const hosting = Array.isArray(firebaseJson.hosting) ? firebaseJson.hosting[0] : firebaseJson.hosting;

/** Hosting 글롭(`@(a|b|c)`)이 이 파일명을 직접 나열하는 규칙의 Cache-Control 값 */
function cacheControlFor(fileName: string): string | undefined {
    const rule = hosting.headers.find((r) => {
        const m = r.source.match(/^@\(([^)]*)\)$/);
        return m ? m[1].split('|').includes(fileName) : r.source === fileName;
    });
    return rule?.headers.find((h) => h.key.toLowerCase() === 'cache-control')?.value;
}

describe('Hosting 캐시 헤더', () => {
    it.each(['sw.js', 'firebase-messaging-sw.js', 'index.html'])(
        '%s는 매번 재검증한다 (no-cache)',
        (file) => {
            expect(cacheControlFor(file)).toMatch(/\bno-cache\b/);
        },
    );

    it.each(['sw.js', 'firebase-messaging-sw.js', 'index.html'])(
        '%s에 no-store를 두지 않는다 — 저장을 막으면 304 재검증이 사라져 확인마다 전체를 다시 받는다',
        (file) => {
            expect(cacheControlFor(file)).not.toMatch(/\bno-store\b/);
        },
    );
});
