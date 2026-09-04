/**
 * DestinationInput — 검색에 잡히지 않는 목적지도 막히지 않고 등록되는지 확인한다.
 *
 * "사천동 일대"처럼 POI 검색이 실패하는 입력에서 운행 시작이 비활성으로 남던 문제의 회귀 테스트.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DestinationInput from '../../components/common/reservation/DestinationInput';
import type { PoiResult } from '../../hooks/usePoiSearch';

// 좌표 캐시 심기를 감시한다 — 목적지를 고르면 경로 계산이 같은 장소를 다시 검색하지
// 않아야 한다(2026-09-05 기준 하루 POI 호출의 약 1/3이 이 중복이었다).
const mockPrimeGeocodeCache = vi.fn();
vi.mock('../../lib/tmap', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../lib/tmap')>()),
    primeGeocodeCache: (...args: unknown[]) => mockPrimeGeocodeCache(...args),
}));

// POI 검색은 네트워크에 의존하므로 훅 자체를 대체한다
const poiState: { results: PoiResult[] } = { results: [] };
vi.mock('../../hooks/usePoiSearch', () => ({
    usePoiSearch: () => ({
        poiResults: poiState.results,
        poiLoading: false,
        showPoiDropdown: poiState.results.length > 0,
        setShowPoiDropdown: vi.fn(),
        clearPoiResults: vi.fn(),
        suppressNext: vi.fn(),
    }),
}));

function renderInput(overrides: Partial<React.ComponentProps<typeof DestinationInput>> = {}) {
    const onChangeDestination = vi.fn();
    const onPendingChange = vi.fn();
    render(
        <DestinationInput
            destination=""
            onChangeDestination={onChangeDestination}
            favorites={[]}
            recentDestinations={[]}
            showFavSave={false}
            setShowFavSave={vi.fn()}
            favName=""
            setFavName={vi.fn()}
            onSaveFavorite={async () => { }}
            onPendingChange={onPendingChange}
            {...overrides}
        />
    );
    return { onChangeDestination, onPendingChange, input: screen.getByRole('textbox') };
}

describe('DestinationInput (목적지 입력)', () => {
    beforeEach(() => {
        poiState.results = [];
        mockPrimeGeocodeCache.mockClear();
    });

    it('검색 결과가 없어도 "그대로 사용" 선택지를 보여주고, 누르면 목적지로 확정된다', () => {
        const { onChangeDestination, input } = renderInput();

        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: '사천동 일대' } });

        const useAsIs = screen.getByText(/‘사천동 일대’ 그대로 사용/);
        fireEvent.mouseDown(useAsIs);

        expect(onChangeDestination).toHaveBeenCalledWith('사천동 일대');
    });

    it('검색 결과가 떠 있어도 Enter는 입력한 그대로를 등록한다', () => {
        poiState.results = [{ name: '사천동주민센터', address: '경남 사천시 어딘가' } as PoiResult];
        const { onChangeDestination, input } = renderInput();

        fireEvent.change(input, { target: { value: '사천동 일대' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(onChangeDestination).toHaveBeenCalledWith('사천동 일대');
    });

    it('방향키로 검색 결과를 고른 뒤 Enter를 누르면 그 장소가 등록된다', () => {
        poiState.results = [{ name: '사천동주민센터', address: '경남 사천시 어딘가' } as PoiResult];
        const { onChangeDestination, input } = renderInput();

        fireEvent.change(input, { target: { value: '사천동' } });
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(onChangeDestination).toHaveBeenCalledWith('사천동주민센터 (경남 사천시 어딘가)');
    });

    it('Enter를 누르지 않고 포커스를 잃어도 입력한 목적지가 확정된다', () => {
        const { onChangeDestination, input } = renderInput();

        fireEvent.change(input, { target: { value: '사천동 일대' } });
        fireEvent.blur(input);

        expect(onChangeDestination).toHaveBeenCalledWith('사천동 일대');
    });


    it('검색 결과를 고르면 좌표를 캐시에 심는다 (경로 계산이 같은 곳을 다시 검색하지 않도록)', () => {
        poiState.results = [
            { name: '사천동주민센터', address: '경남 사천시 어딘가', lat: 35.0, lon: 128.0 } as PoiResult,
        ];
        const { input } = renderInput();

        fireEvent.change(input, { target: { value: '사천동' } });
        fireEvent.mouseDown(screen.getByText('사천동주민센터'));

        // 키는 저장되는 목적지 문자열과 정확히 같아야 한다 — 다르면 캐시가 빗나간다
        expect(mockPrimeGeocodeCache).toHaveBeenCalledWith(
            '사천동주민센터 (경남 사천시 어딘가)',
            { lat: 35.0, lon: 128.0, name: '사천동주민센터' },
        );
    });

    it('방향키+Enter로 고를 때도 좌표를 심는다 (마우스 경로에만 붙이면 절반이 샌다)', () => {
        poiState.results = [
            { name: '사천동주민센터', address: '경남 사천시 어딘가', lat: 35.0, lon: 128.0 } as PoiResult,
        ];
        const { input } = renderInput();

        fireEvent.change(input, { target: { value: '사천동' } });
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(mockPrimeGeocodeCache).toHaveBeenCalledWith(
            '사천동주민센터 (경남 사천시 어딘가)',
            { lat: 35.0, lon: 128.0, name: '사천동주민센터' },
        );
    });

    it('직접 입력한 목적지에는 심지 않는다 (좌표를 모른다)', () => {
        const { input } = renderInput();

        fireEvent.change(input, { target: { value: '사천동 일대' } });
        fireEvent.blur(input);

        expect(mockPrimeGeocodeCache).not.toHaveBeenCalled();
    });

    it('미확정 입력을 부모에 알린다 (제출 버튼 활성 판단용)', () => {
        const { onPendingChange, input } = renderInput();

        fireEvent.change(input, { target: { value: '사천동' } });

        expect(onPendingChange).toHaveBeenCalledWith('사천동');
    });
});
