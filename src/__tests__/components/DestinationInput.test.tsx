/**
 * DestinationInput — 검색에 잡히지 않는 목적지도 막히지 않고 등록되는지 확인한다.
 *
 * "사천동 일대"처럼 POI 검색이 실패하는 입력에서 운행 시작이 비활성으로 남던 문제의 회귀 테스트.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DestinationInput from '../../components/common/reservation/DestinationInput';
import type { PoiResult } from '../../hooks/usePoiSearch';

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

    it('미확정 입력을 부모에 알린다 (제출 버튼 활성 판단용)', () => {
        const { onPendingChange, input } = renderInput();

        fireEvent.change(input, { target: { value: '사천동' } });

        expect(onPendingChange).toHaveBeenCalledWith('사천동');
    });
});
