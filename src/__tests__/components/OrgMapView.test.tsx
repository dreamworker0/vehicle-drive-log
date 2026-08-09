/**
 * OrgMapView — 기관 위치 지도
 *
 * 지도 렌더 자체(Leaflet)는 대체하고, **이 컴포넌트가 스스로 판단하는 것**만 고정한다:
 *  - 팝업을 DOM API로 조립한다(기관명·주소를 innerHTML로 넣지 않는다) — 기관이 직접 입력한
 *    값이 그대로 들어가는 자리라, 문자열 연결로 만들면 저장된 스크립트가 운영자 화면에서 실행된다
 *  - 좌표 저장 전 한국 영역(위도 33~43, 경도 124~132)을 벗어나면 막는다
 *  - 좌표가 없는 기관은 마커를 만들지 않고, 표시 개수에도 세지 않는다
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUpdateOrganization = vi.fn();
vi.mock('../../lib/firestore', () => ({
    updateOrganization: (...a: unknown[]) => mockUpdateOrganization(...a),
}));

/** 마커에 넘어간 팝업 DOM을 테스트에서 꺼내 보기 위한 기록 */
const markers: { latlng: [number, number]; popup: HTMLElement | null }[] = [];
const fitBounds = vi.fn();

vi.mock('leaflet/dist/leaflet.css', () => ({}));
vi.mock('leaflet/dist/images/marker-icon-2x.png', () => ({ default: 'icon2x' }));
vi.mock('leaflet/dist/images/marker-icon.png', () => ({ default: 'icon' }));
vi.mock('leaflet/dist/images/marker-shadow.png', () => ({ default: 'shadow' }));

vi.mock('leaflet', () => {
    const marker = (latlng: [number, number]) => {
        const rec: { latlng: [number, number]; popup: HTMLElement | null } = { latlng, popup: null };
        const api = {
            addTo: () => api,
            bindPopup: (content: HTMLElement) => { rec.popup = content; markers.push(rec); return api; },
            remove: vi.fn(),
        };
        return api;
    };
    const L = {
        map: () => ({
            setView: vi.fn().mockReturnThis(),
            off: vi.fn(),
            remove: vi.fn(),
            fitBounds,
        }),
        tileLayer: () => ({ addTo: vi.fn() }),
        marker,
        featureGroup: () => ({ getBounds: () => ({ pad: () => 'bounds' }) }),
        Icon: { Default: { prototype: {}, mergeOptions: vi.fn() } },
    };
    return { default: L, ...L };
});

import OrgMapView from '../../components/superAdmin/OrgMapView';

const seoul = { id: 'o1', name: '서울복지관', address: '서울시 중구', lat: 37.5665, lng: 126.978 };

/** n번째 마커 팝업을 document에 붙여 조작할 수 있게 한다 */
function mountPopup(index = 0) {
    const popup = markers[index].popup!;
    document.body.appendChild(popup);
    return {
        lat: popup.querySelector<HTMLInputElement>('.coord-lat')!,
        lng: popup.querySelector<HTMLInputElement>('.coord-lng')!,
        save: popup.querySelector<HTMLButtonElement>('.coord-save')!,
        popup,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    markers.length = 0;
    document.body.innerHTML = '';
    mockUpdateOrganization.mockResolvedValue(undefined);
});

describe('표시 개수', () => {
    it('좌표가 있는 기관만 센다', () => {
        render(<OrgMapView orgs={[
            seoul,
            { id: 'o2', name: '부산복지관', address: '부산시', lat: 0, lng: 0 },
        ]} />);
        expect(screen.getByText('1개 기관 표시')).toBeInTheDocument();
    });

    it('기관이 없으면 마커를 만들지 않는다', () => {
        render(<OrgMapView orgs={[]} />);
        expect(markers).toHaveLength(0);
        expect(screen.getByText('0개 기관 표시')).toBeInTheDocument();
    });

    it('좌표가 비어 있는 기관은 마커를 만들지 않는다', () => {
        render(<OrgMapView orgs={[{ id: 'o2', name: '무좌표', address: '어딘가', lat: 0, lng: 0 }]} />);
        expect(markers).toHaveLength(0);
    });
});

describe('팝업 구성', () => {
    it('기관명·주소·좌표를 텍스트로 넣는다', () => {
        render(<OrgMapView orgs={[seoul]} />);
        const { popup } = mountPopup();

        expect(popup.textContent).toContain('서울복지관');
        expect(popup.textContent).toContain('서울시 중구');
        expect(popup.textContent).toContain('좌표: 37.5665, 126.9780');
    });

    it('기관명에 태그가 들어 있어도 요소로 해석되지 않는다 — 저장된 XSS 차단', () => {
        render(<OrgMapView orgs={[{
            ...seoul,
            name: '<img src=x onerror="alert(1)">악성기관',
            address: '<script>alert(2)</script>',
        }]} />);
        const { popup } = mountPopup();

        // textContent로 들어갔으므로 태그가 그대로 글자로 보인다
        expect(popup.textContent).toContain('<img src=x onerror="alert(1)">악성기관');
        expect(popup.querySelector('img')).toBeNull();
        expect(popup.querySelector('script')).toBeNull();
    });

    it('좌표 입력칸에 현재 값이 채워진다', () => {
        render(<OrgMapView orgs={[seoul]} />);
        const { lat, lng } = mountPopup();

        expect(lat.value).toBe('37.5665');
        expect(lng.value).toBe('126.978');
    });
});

describe('좌표 저장', () => {
    it.each([
        ['위도가 남쪽으로 벗어남', '32', '127'],
        ['위도가 북쪽으로 벗어남', '44', '127'],
        ['경도가 서쪽으로 벗어남', '37', '123'],
        ['경도가 동쪽으로 벗어남', '37', '133'],
        ['숫자가 아님', 'abc', '127'],
        ['비어 있음', '', ''],
    ])('한국 영역 밖(%s)이면 저장하지 않고 오류를 알린다', async (_label, latV, lngV) => {
        render(<OrgMapView orgs={[seoul]} />);
        const { lat, lng, save } = mountPopup();

        fireEvent.change(lat, { target: { value: latV } });
        fireEvent.change(lng, { target: { value: lngV } });
        fireEvent.click(save);

        await waitFor(() => expect(save.textContent).toBe('⚠️ 좌표 오류'));
        expect(mockUpdateOrganization).not.toHaveBeenCalled();
        expect(save.disabled).toBe(false);
    });

    it('영역 안이면 저장한다', async () => {
        render(<OrgMapView orgs={[seoul]} />);
        const { lat, lng, save } = mountPopup();

        fireEvent.change(lat, { target: { value: '35.1796' } });
        fireEvent.change(lng, { target: { value: '129.0756' } });
        fireEvent.click(save);

        await waitFor(() => expect(mockUpdateOrganization).toHaveBeenCalledWith('o1', { lat: 35.1796, lng: 129.0756 }));
    });

    it('저장에 실패하면 다시 누를 수 있게 되돌린다', async () => {
        mockUpdateOrganization.mockRejectedValue(new Error('권한 없음'));
        render(<OrgMapView orgs={[seoul]} />);
        const { save } = mountPopup();

        fireEvent.click(save);

        await waitFor(() => expect(save.textContent).toBe('❌ 실패'));
        expect(save.disabled).toBe(false);
    });
});

describe('지도 범위', () => {
    it('마커가 있으면 전체가 보이도록 범위를 맞춘다', () => {
        render(<OrgMapView orgs={[seoul, { id: 'o2', name: '부산', address: '부산', lat: 35.1, lng: 129.0 }]} />);
        expect(markers).toHaveLength(2);
        expect(fitBounds).toHaveBeenCalledWith('bounds', { animate: false });
    });

    it('마커가 없으면 범위를 건드리지 않는다', () => {
        render(<OrgMapView orgs={[{ id: 'o2', name: '무좌표', address: '어딘가', lat: 0, lng: 0 }]} />);
        expect(fitBounds).not.toHaveBeenCalled();
    });
});
