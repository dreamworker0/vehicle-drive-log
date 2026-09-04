import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { resolveOrgSites, type OrgSite } from '../../lib/orgSites';

/**
 * 관리자 화면의 회귀 지점은 **세 항목의 뜻이 겹치지 않는 것**이다.
 *
 * - 기본 차고지: 평소 이 차가 서 있는 곳
 * - 출발지가 매번 바뀜: 켜면 운전자가 운행일지에서 직접 고른다
 * - 현재 위치: 지금 실제로 있는 곳(운행 기록으로 자동 갱신)
 *
 * 셋 다 "출발지"로 부르면 관리자가 무엇을 고치는지 알 수 없다. 그리고 현재 위치는
 * 유동 차량에만 뜬다 — 고정 차량에 물으면 기본 차고지와 뜻이 겹친다.
 */
const SITES: OrgSite[] = resolveOrgSites({
    address: '서울시 본관로 1',
    sites: [{ id: 'site_a', name: '제2분관', address: '경기도 분관로 2' }],
});
const MAIN_ONLY: OrgSite[] = resolveOrgSites({ address: '서울시 본관로 1' });

let mockSites: OrgSite[] = SITES;
vi.mock('../../hooks/useAuth', () => ({
    useAuth: () => ({
        orgFeatures: { googleCalendar: false, allowedUsers: false },
        orgSites: mockSites,
    }),
}));
vi.mock('../../components/admin/VehicleCalendarSection', () => ({
    default: () => null,
}));

const VehicleForm = (await import('../../components/admin/VehicleForm')).default;

type FormData = Parameters<typeof VehicleForm>[0]['form'];

function baseForm(over: Partial<FormData> = {}): FormData {
    return {
        displayName: '스타렉스', modelName: '', plateNumber: '',
        vehicleType: 'van', fuelType: 'diesel', currentKm: '',
        googleCalendarId: '', insuranceCompany: '', insurancePhone: '',
        insuranceExpiryDate: '', allowedUserIds: [],
        siteId: '', siteVaries: false, currentSiteId: '',
        ...over,
    } as FormData;
}

function Harness({ initial }: { initial?: Partial<FormData> }) {
    const [form, setForm] = useState<FormData>(baseForm(initial));
    return (
        <VehicleForm
            form={form}
            setForm={setForm}
            editingVehicle={null}
            formLoading={false}
            onSubmit={() => { }}
            onCancel={() => { }}
            onModelNameChange={() => { }}
            modelSuggestions={[]}
            members={[]}
        />
    );
}

const variesToggle = () => screen.queryByLabelText('출발지가 매번 바뀜');
const currentSiteGroup = () => screen.queryByTestId('vehicle-current-site');

describe('차량 폼 — 유동 차량 지정', () => {
    it('분관을 등록하지 않은 기관에는 체크박스가 나오지 않는다 — 고를 대상이 하나뿐이다', () => {
        mockSites = MAIN_ONLY;
        render(<Harness />);
        expect(variesToggle()).toBeNull();
        mockSites = SITES;
    });

    it('체크박스를 켜야 현재 위치 선택이 나타난다', () => {
        mockSites = SITES;
        render(<Harness />);
        expect(variesToggle()).not.toBeNull();
        expect(currentSiteGroup()).toBeNull();

        fireEvent.click(variesToggle()!);
        expect(currentSiteGroup()).not.toBeNull();
    });

    it('기본 차고지와 현재 위치의 라벨이 서로 다르다', () => {
        mockSites = SITES;
        render(<Harness initial={{ siteVaries: true }} />);
        expect(screen.getByText('기본 차고지')).toBeTruthy();
        expect(screen.getByText('현재 위치')).toBeTruthy();
    });
});
