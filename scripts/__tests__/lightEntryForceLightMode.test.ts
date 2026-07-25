/**
 * lightEntry(비로그인 렌더 경로)의 모든 라우트가 useForceLightMode를 호출하는지
 * 정적으로 강제한다.
 *
 * 왜 필요한가: lightEntry에는 useThemeSync가 마운트되지 않아 `<html>`의 dark 클래스를
 * 스토어 값으로 되돌릴 주체가 없다. 그 경로에서 dark를 켤 수 있는 유일한 코드는
 * useForceLightMode의 cleanup(언마운트 시 스토어가 dark면 재적용)이므로, 훅을 쓰지 않는
 * 공개 라우트가 하나라도 생기면 그 페이지에 dark가 영구 잔류할 수 있다. 공개 페이지
 * 배경에는 dark 변형이 없어(bg-gradient from-surface-50) 밝은 배경 + 다크용 텍스트로
 * 대비가 깨진다.
 *
 * 렌더링 대신 소스를 검사하는 이유: 라우트 추가는 소스 편집이므로 정적 검사로 충분하고,
 * 공개 페이지 전체를 렌더하는 비용(라우터·SEOHead·Firebase)을 피할 수 있다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

/** lightEntry.tsx에서 `<Route ... element={<X ... />}>`의 컴포넌트명을 뽑는다 */
function extractRouteComponents(source: string): string[] {
    const names = new Set<string>();
    const routeRe = /<Route\b[^>]*element=\{([\s\S]*?)\}\s*\/>/g;
    for (const m of source.matchAll(routeRe)) {
        // element 안에 중첩된 모든 컴포넌트를 집는다 (예: <InAppBrowserGuard><LoginPage /></...>)
        for (const c of m[1].matchAll(/<([A-Z][A-Za-z0-9]*)/g)) {
            names.add(c[1]);
        }
    }
    return [...names];
}

/** 컴포넌트명 → 소스 경로 (lightEntry의 import 문에서 해석) */
function resolveComponentPath(entrySource: string, name: string): string | null {
    const importRe = new RegExp(`import\\s+(?:\\{[^}]*\\b${name}\\b[^}]*\\}|${name})\\s+from\\s+['"]([^'"]+)['"]`);
    const m = entrySource.match(importRe);
    if (!m) return null;
    const rel = m[1].replace(/^\.\//, '');
    for (const ext of ['.tsx', '.ts']) {
        const p = resolve(SRC, rel + ext);
        if (existsSync(p)) return p;
    }
    return null;
}

describe('lightEntry 강제 라이트모드 불변식', () => {
    const entryPath = resolve(SRC, 'lightEntry.tsx');
    const entry = readFileSync(entryPath, 'utf-8');

    /**
     * 자체적으로 훅을 호출하지 않아도 되는 라우트 요소.
     * - Navigate: 리다이렉트라 DOM/테마에 관여하지 않는다
     * - InAppBrowserGuard: 순수 위임 래퍼 — 두 분기가 모두 훅을 호출한다(아래 테스트가 검증)
     */
    const EXEMPT = new Set(['Navigate', 'InAppBrowserGuard']);

    it('lightEntry가 useThemeSync를 마운트하지 않음을 전제로 한다', () => {
        // 이 전제가 깨지면(=lightEntry가 테마 소유자를 갖게 되면) 이 테스트의 근거가 바뀐다.
        // 그때는 마운트 순서(자식 effect 우선)로 강제 라이트가 깨지지 않는지 재검토할 것.
        expect(entry).not.toContain('useThemeSync');
    });

    it('라우트 컴포넌트를 하나 이상 추출한다 (파서가 죽지 않았는지)', () => {
        const found = extractRouteComponents(entry).filter(n => !EXEMPT.has(n));
        expect(found.length).toBeGreaterThan(5);
    });

    it('모든 라우트 컴포넌트가 useForceLightMode를 호출한다', () => {
        const components = extractRouteComponents(entry).filter(n => !EXEMPT.has(n));
        const missing: string[] = [];

        for (const name of components) {
            const path = resolveComponentPath(entry, name);
            // import를 해석하지 못하면 조용히 넘기지 않고 실패시킨다 (파서 취약점 은폐 방지)
            expect(path, `${name}의 소스 경로를 해석하지 못했습니다`).not.toBeNull();

            const src = readFileSync(path!, 'utf-8');
            // 자체 호출하거나, children을 그대로 대체·위임하는 래퍼는 예외 없이 호출해야 한다
            if (!src.includes('useForceLightMode(')) missing.push(name);
        }

        expect(
            missing,
            `lightEntry 라우트인데 useForceLightMode()를 호출하지 않습니다: ${missing.join(', ')}\n`
            + '→ 이 경로에는 useThemeSync가 없어 dark 클래스가 영구 잔류할 수 있습니다. '
            + '해당 컴포넌트에서 useForceLightMode()를 호출하세요.',
        ).toEqual([]);
    });

    // InAppBrowserGuard를 EXEMPT로 둔 근거를 고정한다: 위임 래퍼의 대체 분기도 훅을 써야 한다.
    it('InAppBrowserGuard의 대체 분기(InAppBrowserWarning)도 훅을 호출한다', () => {
        const guard = readFileSync(resolve(SRC, 'components/common/InAppBrowserGuard.tsx'), 'utf-8');
        // 가드가 children을 대체하는 컴포넌트명을 소스에서 뽑는다
        const replacement = guard.match(/return\s+<([A-Z][A-Za-z0-9]*)\s*\/>/)?.[1];
        expect(replacement, '가드의 대체 분기를 찾지 못했습니다').toBeTruthy();

        const path = resolve(SRC, `components/common/${replacement}.tsx`);
        expect(existsSync(path), `${replacement} 소스를 찾지 못했습니다`).toBe(true);
        expect(readFileSync(path, 'utf-8')).toContain('useForceLightMode(');
    });
});
