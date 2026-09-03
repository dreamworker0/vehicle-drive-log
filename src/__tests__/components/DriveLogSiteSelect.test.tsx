import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import WaypointSection from '../../components/employee/driveLogFormLayout/WaypointSection';
import type { DriveLogForm } from '../../hooks/driveLogForm/types';
import { resolveOrgSites } from '../../lib/orgSites';

/**
 * 회귀 지점은 **고정 출발지 기관이 하나도 달라지지 않는 것**이다.
 *
 * 분관 등록만으로 선택 UI를 띄우면, 분관을 쓰지만 전 차량이 고정인 기관(=분관 기능을
 * 원래 용도대로 쓰는 대다수)의 운전자에게 얻는 것 없이 잘못 고를 기회만 생긴다.
 * 그래서 차량의 siteVaries가 켜졌을 때만 두 선택이 나와야 한다.
 */
const SITES = resolveOrgSites({
    address: '서울시 본관로 1',
    sites: [
        { id: 'site_a', name: '제2분관', address: '경기도 분관로 2' },
        { id: 'site_b', name: '숙소', address: '경기도 숙소로 3' },
    ],
});
const MAIN_ONLY = resolveOrgSites({ address: '서울시 본관로 1' });

function baseForm(): DriveLogForm {
    return {
        vehicleId: 'v1', vehicleName: '스타렉스',
        driverUid: 'u1', driverName: '홍길동',
        purpose: '', destination: '',
        startTime: '', endTime: '', startKm: '', endKm: '',
        batteryStart: '', batteryEnd: '', notes: '',
        driveDate: '2026-09-04', hipassBalanceAfter: '',
        startSiteId: 'main', endSiteId: 'main',
    };
}

/** 폼 상태를 실제로 들고 있어야 "출발지를 바꾸면 세운 곳도 따라간다"를 검증할 수 있다 */
function Harness({ orgSites = SITES, vehicle }: {
    orgSites?: typeof SITES;
    vehicle?: { siteVaries?: boolean } | null;
}) {
    const [form, setForm] = useState<DriveLogForm>(baseForm());
    return (
        <WaypointSection
            reservationData={null}
            isEditMode={false}
            form={form}
            setForm={setForm}
            favorites={[]}
            showFavSave={false}
            setShowFavSave={() => { }}
            favName=""
            setFavName={() => { }}
            handleFavoriteSelect={() => { }}
            handleSaveFavorite={() => { }}
            orgSites={orgSites}
            selectedVehicle={vehicle}
        />
    );
}

const startSelect = () => screen.queryByLabelText('출발지');
const endSelect = () => screen.queryByLabelText('차를 세운 곳');

describe('운행일지 폼의 출발지·세운 곳 선택', () => {
    it('분관을 등록하지 않은 기관에서는 나오지 않는다', () => {
        render(<Harness orgSites={MAIN_ONLY} vehicle={{ siteVaries: true }} />);
        expect(startSelect()).toBeNull();
        expect(endSelect()).toBeNull();
    });

    it('분관은 등록됐지만 고정 출발지 차량이면 나오지 않는다 — 기존 기관 대다수의 경로다', () => {
        render(<Harness vehicle={{ siteVaries: false }} />);
        expect(startSelect()).toBeNull();
        expect(endSelect()).toBeNull();
    });

    it('차량 정보가 아직 없으면 나오지 않는다', () => {
        render(<Harness vehicle={null} />);
        expect(startSelect()).toBeNull();
    });

    it('유동 차량이면 본관과 분관이 모두 선택지로 나온다', () => {
        render(<Harness vehicle={{ siteVaries: true }} />);
        expect(startSelect()).not.toBeNull();
        expect(endSelect()).not.toBeNull();
        expect(screen.getAllByRole('option', { name: '숙소' })).toHaveLength(2);
    });

    it('출발지를 바꾸면 세운 곳도 따라 바뀐다 — 대부분 왕복이라 확인만 하고 넘어간다', () => {
        render(<Harness vehicle={{ siteVaries: true }} />);
        fireEvent.change(startSelect()!, { target: { value: 'site_b' } });
        expect((startSelect() as HTMLSelectElement).value).toBe('site_b');
        expect((endSelect() as HTMLSelectElement).value).toBe('site_b');
    });

    it('세운 곳을 직접 고른 뒤에는 출발지를 바꿔도 따라가지 않는다 — 편도 운행을 되돌리면 안 된다', () => {
        render(<Harness vehicle={{ siteVaries: true }} />);
        fireEvent.change(endSelect()!, { target: { value: 'site_b' } });
        fireEvent.change(startSelect()!, { target: { value: 'site_a' } });
        expect((startSelect() as HTMLSelectElement).value).toBe('site_a');
        expect((endSelect() as HTMLSelectElement).value).toBe('site_b');
    });
});
