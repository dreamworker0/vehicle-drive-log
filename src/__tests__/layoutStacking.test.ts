/**
 * 레이아웃 헤더의 z-index 순서 고정
 *
 * 알림 패널(.notification-dropdown)은 헤더 안에 있다. 헤더는 sticky+z-index로도,
 * backdrop-filter로도 각각 stacking context를 만들기 때문에 **패널의 z-50은 헤더
 * 내부에서만 유효하고, 바깥에서 패널의 실질 높이는 헤더의 z가 된다.**
 * 헤더가 z-30이던 동안 하단 고정 배너(z-40)들이 알림 패널을 덮고 있었다.
 *
 * 실제 stacking은 jsdom이 계산하지 못하므로(레이아웃·페인트 없음) 값의 순서만 고정한다.
 * 순서가 지켜지는지는 Chromium으로 확인했고, 여기서는 그 순서가 되돌아가지 않게 막는다.
 */
import { describe, it, expect } from 'vitest';

// 소스를 문자열로 읽는다. node:fs는 프론트엔드 tsconfig에 Node 타입이 없어 쓸 수 없고,
// Vite의 ?raw는 vite/client 타입(src/vite-env.d.ts)으로 이미 string으로 잡힌다.
import adminLayout from '../components/admin/AdminLayout.tsx?raw';
import superAdminLayout from '../components/superAdmin/SuperAdminLayout.tsx?raw';
import employeeLayout from '../components/employee/EmployeeLayout.tsx?raw';
import patternBanner from '../components/employee/ReservationPatternBanner.tsx?raw';
import consentGate from '../components/common/ConsentGate.tsx?raw';

const LAYOUTS: Array<[label: string, source: string]> = [
    ['AdminLayout', adminLayout],
    ['SuperAdminLayout', superAdminLayout],
    ['EmployeeLayout', employeeLayout],
];

/** 헤더와 층을 다투는 고정 요소들 */
const OVERLAY_FILES: Array<[label: string, source: string]> = [
    ['원클릭 추천 예약', patternBanner],
    ['약관 재동의', consentGate],
];

/** `z-30` / `z-[45]` 양쪽 표기를 숫자로 읽는다 */
function zOf(className: string): number | null {
    const m = className.match(/(?:^|\s)z-\[?(\d+)\]?(?:\s|$)/);
    return m ? Number(m[1]) : null;
}

function headerZ(source: string): number {
    const m = source.match(/<header className="([^"]+)"/);
    if (!m) throw new Error('header를 찾지 못했다');
    const z = zOf(m[1]);
    if (z === null) throw new Error(`header에 z-index가 없다: ${m[1]}`);
    return z;
}

/**
 * 고정 요소를 배너와 모달로 나눈다.
 *  - 배너: 화면 한쪽에 붙는 띠(`bottom-*`). 헤더보다 **아래**여야 알림 패널을 가리지 않는다.
 *  - 모달: 화면 전체를 덮는 것(`inset-0`). 헤더보다 **위**여야 한다.
 * 같은 파일에 둘이 함께 있는 경우가 있어(ConsentGate) 반드시 구분해야 한다.
 */
function overlaysIn(source: string): { banners: number[]; modals: number[] } {
    const banners: number[] = [];
    const modals: number[] = [];

    for (const [chunk] of source.matchAll(/className=\{?[`"][^`"]*\bfixed\b[^`"]*[`"]/g)) {
        const z = zOf(chunk);
        if (z === null) continue;
        if (/\binset-0\b/.test(chunk)) modals.push(z);
        else if (/\bbottom-/.test(chunk)) banners.push(z);
    }
    return { banners, modals };
}

describe('레이아웃 헤더 z-index', () => {
    it.each(LAYOUTS)('%s — 헤더가 하단 고정 배너보다 위에 있다', (_label, source) => {
        const z = headerZ(source);

        for (const [label, overlaySource] of OVERLAY_FILES) {
            for (const bannerZ of overlaysIn(overlaySource).banners) {
                expect(z, `${label}(z-${bannerZ})가 알림 패널을 덮는다 — 헤더 z-${z}`).toBeGreaterThan(bannerZ);
            }
        }
    });

    it.each(LAYOUTS)('%s — 헤더가 모달보다 아래에 있다', (_label, source) => {
        // 위쪽 조건만 만족시키려고 헤더를 올리면 이번엔 헤더가 모달을 덮는다
        const z = headerZ(source);

        for (const [label, overlaySource] of OVERLAY_FILES) {
            for (const modalZ of overlaysIn(overlaySource).modals) {
                expect(z, `헤더(z-${z})가 ${label} 모달(z-${modalZ})을 덮는다`).toBeLessThan(modalZ);
            }
        }
    });

    it('배너와 모달을 실제로 읽고 있다 (검사가 공회전하지 않는지)', () => {
        // 정규식이 아무것도 못 잡으면 위 두 검사가 조용히 통과해 버린다
        const all = OVERLAY_FILES.map(([, source]) => overlaysIn(source));

        expect(all.flatMap((o) => o.banners), '하단 배너를 하나도 못 읽었다').not.toHaveLength(0);
        expect(all.flatMap((o) => o.modals), '모달을 하나도 못 읽었다').not.toHaveLength(0);
    });
});
