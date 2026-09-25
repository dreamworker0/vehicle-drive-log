/**
 * Hosting 캐시 헤더 — 서비스 워커 스크립트는 **브라우저는 매번 확인하고, CDN은 저장해 304로 답한다.**
 *
 * 왜 필요한가 — 2026-09-25 결제 SKU 점검에서 Hosting 전송량이 30일 23.7 GiB(무료 10 GiB의
 * 2.4배, 전체 요금의 18%)였다. 원인은 `sw.js`(압축 후 약 180 KB)였다. 앱은 10분마다, 그리고
 * 탭으로 돌아올 때마다 `registration.update()`로 새 버전을 확인한다(main.tsx·UpdatePrompt).
 *
 * 두 단계로 알게 됐다.
 *  1) 헤더가 `no-cache, no-store, must-revalidate`라 확인마다 전체를 다시 받았다.
 *  2) `no-store`만 빼고 `no-cache`로 배포해 보니(#408) **그래도 매번 200 전체**였다.
 *     `no-cache` 응답은 Hosting CDN이 저장하지 않고 원본으로 넘기는데(`X-Cache: MISS`),
 *     원본은 조건부 요청(If-None-Match)에 304를 주지 않는다. 304는 CDN 가장자리에
 *     **저장된** 파일에서만 나온다 — 실측으로 `max-age`가 있는 파일은 304, 0 바이트였다.
 *
 * 그래서 `max-age=0, must-revalidate`로 브라우저가 매번 확인하게 두고, `s-maxage`로 CDN이
 * 저장하게 한다. Hosting은 **배포할 때마다 CDN 캐시를 비우므로** 새 버전 반영은 늦어지지 않는다.
 * 둘 중 하나라도 빠지면 조용히 전송량만 늘어나므로 정적으로 못박는다.
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
function cacheControlFor(fileName: string): string {
    const rule = hosting.headers.find((r) => {
        const m = r.source.match(/^@\(([^)]*)\)$/);
        return m ? m[1].split('|').includes(fileName) : r.source === fileName;
    });
    return rule?.headers.find((h) => h.key.toLowerCase() === 'cache-control')?.value ?? '';
}

const FILES = ['sw.js', 'firebase-messaging-sw.js', 'index.html'];

describe('Hosting 캐시 헤더', () => {
    it.each(FILES)('%s는 브라우저가 매번 재검증한다 (max-age=0 + must-revalidate)', (file) => {
        expect(cacheControlFor(file)).toMatch(/\bmax-age=0\b/);
        expect(cacheControlFor(file)).toMatch(/\bmust-revalidate\b/);
    });

    it.each(FILES)('%s는 CDN이 저장한다 (s-maxage) — 그래야 조건부 요청에 304로 답한다', (file) => {
        expect(cacheControlFor(file)).toMatch(/\bs-maxage=\d+/);
    });

    it.each(FILES)('%s에 no-store·no-cache를 두지 않는다 — CDN이 저장하지 않아 확인마다 전체를 다시 보낸다', (file) => {
        expect(cacheControlFor(file)).not.toMatch(/\bno-store\b/);
        expect(cacheControlFor(file)).not.toMatch(/\bno-cache\b/);
    });
});
