import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import OrgSitesSection from '../../components/admin/settings/OrgSitesSection';
import type { SettingsForm } from '../../hooks/useSettings';
import type { OrgSite } from '../../lib/orgSites';

/**
 * 회귀 지점: 저장을 눌러도 입력칸이 그대로 남아 있어 저장이 됐는지 알 수 없던 화면.
 * 저장된 출발지는 한 줄 목록으로 접히고, 편집 중일 때만 [출발지 저장]이 보여야 한다.
 */
function baseForm(sites: OrgSite[]): SettingsForm {
    return {
        name: '테스트복지관',
        adminEmail: 'admin@test.com',
        address: '서울시 본관로 1',
        phone: '010-1234-5678',
        approvalLine: [{ title: '담당' }],
        hideApprovalLine: false,
        requireReservationApproval: false,
        hipassEnabled: true,
        maintenanceEnabled: true,
        maintenanceEmployeeAccess: true,
        allowedUsersEnabled: true,
        googleCalendarEnabled: true,
        driverSelectionEnabled: true,
        coDriverEnabled: true,
        passengerEnabled: true,
        passengerAllowList: true,
        passengerAllowSearch: true,
        passengerAllowCount: true,
        reservationPassengerEnabled: false,
        driverAllowList: true,
        driverAllowSearch: true,
        sites,
    };
}

const SAVED: OrgSite = { id: 'site_a', name: '분관', address: '충북 증평군 증평읍 북부두름길 80' };

function setup(sites: OrgSite[] = [SAVED], saveResult = true) {
    const props = {
        form: baseForm(sites),
        onAddSite: vi.fn(() => 'site_new'),
        onSiteChange: vi.fn(),
        onRemoveSite: vi.fn(),
        onSaveSites: vi.fn(async () => saveResult),
        saving: false,
    };
    const view = render(<OrgSitesSection {...props} />);
    return { ...view, props };
}

describe('OrgSitesSection', () => {
    it('저장된 출발지는 입력칸 없이 한 줄로 보여 준다', () => {
        setup();
        expect(screen.getByText('분관')).toBeInTheDocument();
        expect(screen.getByText('충북 증평군 증평읍 북부두름길 80')).toBeInTheDocument();
        expect(screen.queryByLabelText('출발지 이름')).not.toBeInTheDocument();
    });

    it('편집 중인 줄이 없으면 [출발지 저장]을 띄우지 않는다', () => {
        setup();
        expect(screen.queryByRole('button', { name: '출발지 저장' })).not.toBeInTheDocument();
    });

    it('[수정]을 누른 줄만 입력칸이 열리고 저장 버튼이 나타난다', () => {
        setup();
        fireEvent.click(screen.getByRole('button', { name: '분관 수정' }));
        expect(screen.getByLabelText('출발지 이름')).toHaveValue('분관');
        expect(screen.getByRole('button', { name: '출발지 저장' })).toBeInTheDocument();
    });

    it('저장에 성공하면 입력칸을 접는다', async () => {
        const { props } = setup();
        fireEvent.click(screen.getByRole('button', { name: '분관 수정' }));
        fireEvent.click(screen.getByRole('button', { name: '출발지 저장' }));
        await waitFor(() => expect(props.onSaveSites).toHaveBeenCalled());
        await waitFor(() => expect(screen.queryByLabelText('출발지 이름')).not.toBeInTheDocument());
    });

    it('저장에 실패하면 입력칸을 그대로 둔다 — 다시 누를 자리가 사라지면 안 된다', async () => {
        setup([SAVED], false);
        fireEvent.click(screen.getByRole('button', { name: '분관 수정' }));
        fireEvent.click(screen.getByRole('button', { name: '출발지 저장' }));
        await waitFor(() => expect(screen.getByLabelText('출발지 이름')).toBeInTheDocument());
    });

    it('[취소]는 편집 전 값으로 되돌린다', () => {
        const { props } = setup();
        fireEvent.click(screen.getByRole('button', { name: '분관 수정' }));
        fireEvent.change(screen.getByLabelText('출발지 이름'), { target: { value: '제2분관' } });
        fireEvent.click(screen.getByRole('button', { name: '취소' }));
        expect(props.onSiteChange).toHaveBeenLastCalledWith('site_a', { name: '분관', address: SAVED.address });
    });

    it('새로 추가한 빈 줄은 [취소]로 목록에서 뺀다 (저장 호출 없이)', () => {
        const onRemoveSite = vi.fn();
        const onSaveSites = vi.fn(async () => true);
        // 추가된 줄은 부모가 form.sites에 넣어 주므로, 그 흐름을 상태로 재현한다
        function Harness() {
            const [sites, setSites] = useState<OrgSite[]>([]);
            return (
                <OrgSitesSection
                    form={baseForm(sites)}
                    onAddSite={() => {
                        setSites([{ id: 'site_new', name: '', address: '' }]);
                        return 'site_new';
                    }}
                    onSiteChange={vi.fn()}
                    onRemoveSite={id => { onRemoveSite(id); setSites(prev => prev.filter(s => s.id !== id)); }}
                    onSaveSites={onSaveSites}
                    saving={false}
                />
            );
        }
        render(<Harness />);

        fireEvent.click(screen.getByRole('button', { name: '+ 출발지 추가' }));
        expect(screen.getByLabelText('출발지 이름')).toHaveValue('');

        fireEvent.click(screen.getByRole('button', { name: '취소' }));
        expect(onRemoveSite).toHaveBeenCalledWith('site_new');
        expect(onSaveSites).not.toHaveBeenCalled();
        expect(screen.queryByLabelText('출발지 이름')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '출발지 저장' })).not.toBeInTheDocument();
    });
});
