/**
 * 공개 페이지 컴포넌트 전체가 useForceLightMode를 호출하는지 정적으로 강제한다.
 * 공개 페이지 목록은 LightApp.tsx의 Route에서 추출한다(그 경로가 곧 공개 페이지 집합).
 * 라우팅이 lightEntry.tsx에서 LightApp.tsx로 옮겨졌고(랜딩 LCP 개선을 위한 지연 로딩 도입),
 * 대부분의 라우트가 `lazyWithRetry(() => import('...'))` 형태가 되어 아래 파서가 둘 다 읽는다.
 *
 * 왜 필요한가: **두 렌더 경로 모두** 테마 소유자를 마운트한다 — appEntry는 `App` 본문에서
 * useThemeSync를 호출하고, lightEntry는 `ThemeRoot`로 감싼다. 따라서 사용자 선호가 dark면
 * `<html>`에 dark가 적용되며, 강제 라이트를 등록하지 않은 공개 페이지는 **다크로 렌더된다**.
 * 대상 4곳(FAQ·약관·개인정보·릴리즈노트)은 최상위 배경에 dark 변형이 없어
 * (bg-gradient from-surface-50) 밝은 배경 + 다크용 텍스트로 대비가 깨진다.
 * 공개 페이지 컴포넌트는 appEntry에서도 재사용된다(App.tsx의 /terms·/privacy·
 * /release-notes·/faq·/apply, `AuthGuard requireGuest`로 렌더되는 /·/login).
 *
 * ⚠️ 알려진 한계: 공개 페이지 목록을 **LightApp.tsx에서만** 열거하므로, App.tsx에만
 * 공개 라우트를 추가하고 lightEntry에 빠뜨리면 이 검사를 통과한다. 두 엔트리에 같은
 * 공개 라우트를 등록하는 현재 관행이 전제다(한쪽만 추가하는 것은 그 자체로 결함).
 *
 * 렌더링 대신 소스를 검사하는 이유: 라우트 추가는 소스 편집이므로 정적 검사로 충분하고,
 * 공개 페이지 전체를 렌더하는 비용(라우터·SEOHead·Firebase)을 피할 수 있다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

/** LightApp.tsx에서 `<Route ... element={<X ... />}>`의 컴포넌트명을 뽑는다 */
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

/**
 * 컴포넌트명 → 소스 경로.
 * 정적 import와 지연 로딩(`const X = lazyWithRetry(() => import('...'))`) 둘 다 해석한다 —
 * 한쪽만 보면 지연 로딩으로 바꾼 라우트가 조용히 검사에서 빠진다.
 */
function resolveComponentPath(entrySource: string, name: string): string | null {
    const staticRe = new RegExp(`import\\s+(?:\\{[^}]*\\b${name}\\b[^}]*\\}|${name})\\s+from\\s+['"]([^'"]+)['"]`);
    const lazyRe = new RegExp(`const\\s+${name}\\s*=\\s*(?:lazyWithRetry|lazy)\\(\\s*\\(\\)\\s*=>\\s*import\\(\\s*['"]([^'"]+)['"]`);
    const m = entrySource.match(staticRe) ?? entrySource.match(lazyRe);
    if (!m) return null;
    const rel = m[1].replace(/^\.\//, '');
    for (const ext of ['.tsx', '.ts']) {
        const p = resolve(SRC, rel + ext);
        if (existsSync(p)) return p;
    }
    return null;
}

describe('공개 페이지 강제 라이트모드 불변식', () => {
    // 라우트 정의(=공개 페이지 집합)는 LightApp에, 테마 소유자 마운트는 lightEntry에 있다.
    const entry = readFileSync(resolve(SRC, 'LightApp.tsx'), 'utf-8');
    const bootstrap = readFileSync(resolve(SRC, 'lightEntry.tsx'), 'utf-8');

    /**
     * 자체적으로 훅을 호출하지 않아도 되는 라우트 요소.
     * - Navigate: 리다이렉트라 DOM/테마에 관여하지 않는다
     * - InAppBrowserGuard: 순수 위임 래퍼 — 두 분기가 모두 훅을 호출한다(아래 테스트가 검증)
     * - OrgApplicationPage: **의도적으로 다크를 지원한다**(최상위 배경부터 폼 요소까지
     *   dark: 변형이 온전함) → 강제 라이트를 걸지 않고 사용자 테마를 따른다
     * - OrgApplicationRoute: OrgApplicationPage를 AuthProvider로만 감싸는 순수 위임 래퍼
     *   (아래 테스트가 실제로 위임만 하는지 확인한다)
     */
    const EXEMPT = new Set(['Navigate', 'InAppBrowserGuard', 'OrgApplicationPage', 'OrgApplicationRoute']);

    it('lightEntry도 테마 소유자(ThemeRoot)를 마운트한다', () => {
        // 이 전제가 있어야 비로그인 경로에서도 dark 클래스·theme-color가 스토어와 일치한다.
        // (예전에는 소유자가 없어 index.html이 박은 다크 theme-color가 라이트 화면에 남았다)
        expect(bootstrap).toContain('ThemeRoot');
    });

    it('강제 라이트 예외 페이지는 다크 지원이 실제로 갖춰져 있다', () => {
        // EXEMPT에 올린 근거(다크 지원 완비)가 사실인지 확인한다. 색상 클래스에 dark: 변형이
        // 빠지면 예외 근거가 무너지므로, 최상위 컨테이너의 dark 배경을 대표값으로 검사한다.
        const src = readFileSync(resolve(SRC, 'components/auth/OrgApplicationPage.tsx'), 'utf-8');
        expect(src).toMatch(/min-h-screen[^"]*dark:from-/);
        // 호출 여부로 본다 (주석에서 훅 이름을 언급할 수 있으므로 단순 포함 검사는 부정확)
        expect(src).not.toContain('useForceLightMode(');
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
            `공개 페이지인데 useForceLightMode()를 호출하지 않습니다: ${missing.join(', ')}\n`
            + '→ 이 컴포넌트들은 appEntry(App.tsx)에서도 재사용되며, 거기서는 useThemeSync가 '
            + '사용자 선호(dark)를 DOM에 적용합니다. 강제 라이트를 등록하지 않으면 다크로 '
            + '렌더되어 대비가 깨집니다. 해당 컴포넌트에서 useForceLightMode()를 호출하세요.',
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

    // OrgApplicationRoute를 EXEMPT로 둔 근거를 고정한다: AuthProvider로 감싸기만 하는
    // 위임 래퍼라 화면 자체는 OrgApplicationPage가 그린다(그쪽은 다크 지원이 완비돼 예외다).
    // 이 래퍼가 언젠가 자체 화면을 그리게 되면 예외 근거가 무너지므로 여기서 붙잡는다.
    it('OrgApplicationRoute는 OrgApplicationPage에 위임하는 래퍼다', () => {
        const src = readFileSync(resolve(SRC, 'components/auth/OrgApplicationRoute.tsx'), 'utf-8');
        expect(src).toContain('OrgApplicationPage');
        // 렌더하는 요소가 AuthProvider와 OrgApplicationPage뿐인지 확인한다
        const rendered = [...src.matchAll(/<([A-Z][A-Za-z0-9]*)/g)].map(m => m[1]);
        expect([...new Set(rendered)].sort()).toEqual(['AuthProvider', 'OrgApplicationPage']);
    });

    // 랜딩은 LCP를 결정하는 화면이라 **정적 import**로 남겨야 한다.
    // 지연 로딩으로 바꾸면 청크 왕복이 하나 더 붙어 첫 화면이 그만큼 늦어진다
    // (2026-08-09 LCP 개선 작업의 전제).
    it('랜딩만은 지연 로딩하지 않는다', () => {
        expect(entry).toMatch(/^import LandingPage from/m);
        expect(entry).not.toMatch(/const\s+LandingPage\s*=\s*lazy/);
    });
});
