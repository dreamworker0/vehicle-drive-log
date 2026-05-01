import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 환경변수 모킹 (Vite 환경)
vi.stubEnv('VITE_TMAP_API_KEY', 'test-key');

// 모듈 상태 초기화를 위해 동적 import
let isTmapCoolingDown: () => boolean, isTmapAvailable: () => boolean, parseDestinations: (s: string) => string[], MAX_DESTINATIONS: number;

beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../lib/tmap.js');
    isTmapCoolingDown = mod.isTmapCoolingDown;
    isTmapAvailable = mod.isTmapAvailable;
    parseDestinations = mod.parseDestinations;
    MAX_DESTINATIONS = mod.MAX_DESTINATIONS;
});

afterEach(() => {
    document.head.innerHTML = '';
    vi.restoreAllMocks();
    vi.clearAllTimers();
});

describe('tmap 유틸리티', () => {
    it('초기 상태에서 쿨다운이 아니어야 한다', () => {
        expect(isTmapCoolingDown()).toBe(false);
    });

    it('API 키가 있으면 사용 가능해야 한다', () => {
        expect(isTmapAvailable()).toBe(true);
    });
});

describe('parseDestinations', () => {
    it('단일 목적지를 배열로 반환한다', () => {
        expect(parseDestinations('서울시청')).toEqual(['서울시청']);
    });

    it('여러 목적지를 쉼표로 분리한다', () => {
        expect(parseDestinations('서울시청, 강남역')).toEqual(['서울시청', '강남역']);
    });

    it('여러 목적지를 쉼표로 분리 (3곳)', () => {
        expect(parseDestinations('서울시청, 강남역, 종로구청')).toEqual(['서울시청', '강남역', '종로구청']);
    });

    it('앞뒤 공백을 제거한다', () => {
        expect(parseDestinations('  서울시청 , 강남역  ')).toEqual(['서울시청', '강남역']);
    });

    it('빈 문자열은 빈 배열을 반환한다', () => {
        expect(parseDestinations('')).toEqual([]);
    });

    it('null은 빈 배열을 반환한다', () => {
        expect(parseDestinations(null as unknown as string)).toEqual([]);
    });

    it('공백만 있으면 빈 배열을 반환한다', () => {
        expect(parseDestinations('   ')).toEqual([]);
    });

    it('빈 쉼표 항목은 제거한다', () => {
        expect(parseDestinations('서울시청,,강남역,')).toEqual(['서울시청', '강남역']);
    });

    it(`최대 ${5}곳으로 제한한다`, () => {
        const result = parseDestinations('A, B, C, D, E, F, G');
        expect(result).toHaveLength(MAX_DESTINATIONS);
        expect(result).toEqual(['A', 'B', 'C', 'D', 'E']);
    });
});
