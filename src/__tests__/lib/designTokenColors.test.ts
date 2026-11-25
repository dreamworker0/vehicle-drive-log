/**
 * 디자인 토큰 색상 규칙(.agent/rules/design-system.md) — Tailwind 기본 blue·green·slate·gray를 쓰지 않는다
 *
 * 2026-11-25에 323곳을 primary·accent·surface로 바꿨다. 같은 계열이라 색차는 OKLab ΔE 3 이하로
 * 눈에 띄지 않는다. 다시 섞이지 않게 소스 전체를 검사한다.
 * 예외: 차량 색상 팔레트(lib/constants.ts의 VEHICLE_COLORS)는 일부러 여러 색상을 쓴다.
 * emerald·indigo·teal·cyan은 토큰으로 바꾸면 색조가 눈에 띄게 달라져 아직 검사하지 않는다.
 */
import { describe, it, expect } from 'vitest';

const sources = import.meta.glob(['../../**/*.{ts,tsx}', '../../index.css', '!../../__tests__/**'], {
    query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const ALLOWED_FILES = [/\/lib\/constants\.ts$/];
const DEFAULT_COLOR = /(?<![\w/])(?:[\w[\]&>:@.-]+:)*[a-z]+(?:-[a-z]+)*-(?:blue|green|slate|gray)-\d{2,3}(?![\w])/g;

describe('디자인 토큰 색상', () => {
    it('소스가 실제로 읽힌다', () => {
        expect(Object.keys(sources).length).toBeGreaterThan(100);
    });

    it('Tailwind 기본 blue·green·slate·gray 클래스를 쓰지 않는다 — primary·accent·surface를 쓴다', () => {
        const hits: string[] = [];
        for (const [file, src] of Object.entries(sources)) {
            if (ALLOWED_FILES.some(re => re.test(file))) continue;
            for (const m of src.matchAll(DEFAULT_COLOR)) hits.push(`${file}: ${m[0]}`);
        }
        expect(hits).toEqual([]);
    });
});
