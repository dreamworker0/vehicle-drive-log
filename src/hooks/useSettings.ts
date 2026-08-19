/**
 * useSettings — 기관 설정 상태 관리 + 비즈니스 로직
 * Settings에서 추출된 커스텀 훅
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from './useAuth';
import { useToast } from './useToast';
import { useConfirm } from './useConfirm';
import { getOrganization, updateOrganization, regenerateInviteCode, getCustomHolidays, addCustomHoliday, deleteCustomHoliday } from '../lib/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { fetchPublicHolidays, groupHolidaysByMonth } from '../lib/holidayApi';
import { formatDateKr } from '../lib/dateUtils';
import { formatPhoneNumber } from './useOrgApplication';
import { resolveOrgFeatures } from '../lib/orgFeatures';
import { createSiteId, type OrgSite } from '../lib/orgSites';
import type { Organization, WithdrawReason } from '../types/organization';
import type { CustomHoliday } from '../types/holiday';

export interface SettingsForm {
    name: string;
    adminEmail: string;
    address: string;
    phone: string;
    approvalLine: { title: string }[];
    hideApprovalLine: boolean;
    requireReservationApproval: boolean;
    // 기능 사용 토글(실제 켜짐 여부 boolean)
    hipassEnabled: boolean;
    maintenanceEnabled: boolean;
    maintenanceEmployeeAccess: boolean;
    allowedUsersEnabled: boolean;
    googleCalendarEnabled: boolean;
    driverSelectionEnabled: boolean;
    coDriverEnabled: boolean;
    passengerEnabled: boolean;
    passengerAllowList: boolean;
    passengerAllowSearch: boolean;
    passengerAllowCount: boolean;
    /** 예약 화면 동승자 입력(opt-in — 기본 꺼짐) */
    reservationPassengerEnabled: boolean;
    driverAllowList: boolean;
    driverAllowSearch: boolean;
    /** 분관·별관 등 추가 출발지(차고지). 본관(기관 주소)은 포함하지 않는다. */
    sites: OrgSite[];
}

interface HolidayForm {
    date: string;
    name: string;
}

export default function useSettings() {
    const { userData } = useAuth();
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const [org, setOrg] = useState<Organization | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    /**
     * 출발지 카드 전용 저장 상태.
     *
     * 기관 정보 카드와 `saving`을 공유했더니 출발지를 저장할 때 **위쪽 [변경사항 저장]
     * 버튼이 대신 돌았다** — 누른 자리에는 아무 반응이 없고 엉뚱한 버튼이 반응하는 상태였다.
     */
    const [savingSites, setSavingSites] = useState(false);
    const [success, setSuccess] = useState(false);
    const [withdrawing, setWithdrawing] = useState(false);
    const [form, setForm] = useState<SettingsForm>({
        name: '',
        adminEmail: '',
        address: '',
        phone: '',
        approvalLine: [{ title: '담당' }, { title: '팀장' }],
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
        sites: [],
    });

    // 공휴일 관리 상태
    const [holidayYear, setHolidayYear] = useState(new Date().getFullYear());
    const [customHolidays, setCustomHolidays] = useState<CustomHoliday[]>([]);
    const [holidayForm, setHolidayForm] = useState<HolidayForm>({ date: '', name: '' });
    const [addingHoliday, setAddingHoliday] = useState(false);
    const [publicHolidays, setPublicHolidays] = useState<Record<string, { date: string; name: string }[]>>({});

    const orgId = userData?.organizationId;

    useEffect(() => {
        if (!orgId) return;
        const fetch = async () => {
            try {
                const [data, holidays] = await Promise.all([
                    getOrganization(orgId),
                    getCustomHolidays(orgId),
                ]);
                if (data) {
                    const orgData = data as Organization;
                    setOrg(orgData);
                    const features = resolveOrgFeatures(orgData);
                    setForm({
                        name: orgData.name || '',
                        adminEmail: orgData.adminEmail || '',
                        address: orgData.address || '',
                        phone: formatPhoneNumber(orgData.phone || ''),
                        approvalLine: (orgData.approvalLine && orgData.approvalLine.length > 0)
                            ? orgData.approvalLine
                            : [{ title: '담당' }, { title: '팀장' }],
                        hideApprovalLine: orgData.hideApprovalLine ?? false,
                        requireReservationApproval: orgData.requireReservationApproval ?? false,
                        hipassEnabled: features.hipass,
                        maintenanceEnabled: features.maintenance,
                        maintenanceEmployeeAccess: features.maintenanceEmployeeAccess,
                        allowedUsersEnabled: features.allowedUsers,
                        googleCalendarEnabled: features.googleCalendar,
                        driverSelectionEnabled: features.driverSelection,
                        coDriverEnabled: features.coDriver,
                        passengerEnabled: features.passenger,
                        passengerAllowList: features.passengerAllowList,
                        passengerAllowSearch: features.passengerAllowSearch,
                        passengerAllowCount: features.passengerAllowCount,
                        reservationPassengerEnabled: features.reservationPassenger,
                        driverAllowList: features.driverAllowList,
                        driverAllowSearch: features.driverAllowSearch,
                        sites: orgData.sites ? orgData.sites.map(site => ({ ...site })) : [],
                    });
                }
                setCustomHolidays(holidays as CustomHoliday[]);
            } catch (err) {
                console.error('기관 정보 로드 실패:', err);
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, [orgId]);

    useEffect(() => {
        let cancelled = false;
        const loadHolidays = async () => {
            try {
                const map = await fetchPublicHolidays(holidayYear);
                if (!cancelled) setPublicHolidays(groupHolidaysByMonth(map));
            } catch (err) {
                console.error('공휴일 로드 실패:', err);
            }
        };
        loadHolidays();
        return () => { cancelled = true; };
    }, [holidayYear]);

    const filteredCustomHolidays = useMemo(() => {
        return customHolidays
            .filter(h => h.date?.startsWith(String(holidayYear)))
            .sort((a, b) => a.date.localeCompare(b.date));
    }, [customHolidays, holidayYear]);

    const handleSave = async (e?: React.FormEvent | null, overrides?: Partial<SettingsForm>) => {
        if (e) e.preventDefault();
        if (!orgId) return;
        setSaving(true);
        // 저장 실패 시 되돌릴 이전 값(변경 필드 한정). 최신 상태 기준으로 보관한다.
        let rollback: Partial<SettingsForm> | null = null;
        if (overrides) {
            // 변경 필드의 이전 값을 동기적으로 캡처(각 토글은 서로 다른 키만 건드리므로
            // 연속 클릭 상황에서도 해당 키 롤백은 정확하다).
            const snapshot: Partial<SettingsForm> = {};
            for (const key of Object.keys(overrides) as (keyof SettingsForm)[]) {
                (snapshot as Record<string, unknown>)[key] = form[key];
            }
            rollback = snapshot;
            // 기능 토글은 즉시 로컬 상태에 병합하고 변경 필드만 저장한다.
            // 연속 클릭이 같은 이전 form 전체를 보내 서로의 변경을 되돌리는 경쟁을 막는다.
            setForm(prev => ({ ...prev, ...overrides }));
        }
        const targetData = overrides ? null : form;
        try {
            if (overrides) {
                await updateOrganization(orgId, overrides);
            } else if (targetData) {
                await updateOrganization(orgId, {
                    name: targetData.name.trim(),
                    adminEmail: targetData.adminEmail.trim(),
                    address: targetData.address.trim(),
                    phone: targetData.phone.trim(),
                    approvalLine: targetData.approvalLine.filter(a => a.title.trim()).map(a => ({ title: a.title.trim() })),
                    hideApprovalLine: targetData.hideApprovalLine,
                    requireReservationApproval: targetData.requireReservationApproval,
                    hipassEnabled: targetData.hipassEnabled,
                    maintenanceEnabled: targetData.maintenanceEnabled,
                    maintenanceEmployeeAccess: targetData.maintenanceEmployeeAccess,
                    allowedUsersEnabled: targetData.allowedUsersEnabled,
                    googleCalendarEnabled: targetData.googleCalendarEnabled,
                    driverSelectionEnabled: targetData.driverSelectionEnabled,
                    coDriverEnabled: targetData.coDriverEnabled,
                    passengerEnabled: targetData.passengerEnabled,
                    passengerAllowList: targetData.passengerAllowList,
                    passengerAllowSearch: targetData.passengerAllowSearch,
                    passengerAllowCount: targetData.passengerAllowCount,
                    reservationPassengerEnabled: targetData.reservationPassengerEnabled,
                    driverAllowList: targetData.driverAllowList,
                    driverAllowSearch: targetData.driverAllowSearch,
                    sites: targetData.sites,
                });
            }
            setSuccess(true);
            setTimeout(() => setSuccess(false), 3000);
        } catch (err) {
            console.error('저장 실패:', err);
            // 즉시 저장 토글의 낙관적 반영을 이전 값으로 되돌린다.
            if (rollback) {
                const revert = rollback as Partial<SettingsForm>;
                setForm(prev => ({ ...prev, ...revert }));
            }
            showToast('저장에 실패했습니다.', 'error');
        } finally {
            setSaving(false);
        }
    };

    // 전화번호 포맷팅 핸들러 (010-0000-0000)
    const handlePhoneChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const formatted = formatPhoneNumber(e.target.value);
        setForm(prev => ({ ...prev, phone: formatted }));
    }, []);

    const handleRegenCode = async () => {
        if (!orgId) return;
        if (!await confirm({ message: '초대 코드를 재발급하시겠습니까?\n기존 코드는 더 이상 사용할 수 없습니다.', confirmColor: 'warning' })) return;
        try {
            const newCode = await regenerateInviteCode(orgId);
            setOrg(prev => prev ? ({ ...prev, inviteCode: newCode }) : null);
        } catch (err) {
            console.error('코드 재발급 실패:', err);
        }
    };

    // 기관 서비스 해지 (자발적 탈퇴) — Admin SDK callable 호출
    // 성공 시 본인 user 문서가 삭제되며 auth/org 리스너가 자동 로그아웃·초대코드 화면으로 이동시킨다.
    const handleWithdraw = async (reason: WithdrawReason, reasonDetail?: string) => {
        if (!orgId) return;
        setWithdrawing(true);
        try {
            const withdrawOrganization = httpsCallable(getFunctions(undefined, 'asia-northeast3'), 'withdrawOrganization');
            await withdrawOrganization({ organizationId: orgId, reason, reasonDetail });
            showToast('서비스가 해지되었습니다.', 'success');
            // 본인 문서 삭제로 인한 자동 로그아웃까지 약간의 시간차가 있을 수 있어 별도 후처리는 하지 않는다.
        } catch (err) {
            console.error('서비스 해지 실패:', err);
            showToast('서비스 해지에 실패했습니다. 잠시 후 다시 시도해주세요.', 'error');
            setWithdrawing(false);
        }
    };

    const handleAddHoliday = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!holidayForm.date || !holidayForm.name.trim() || !orgId) return;
        setAddingHoliday(true);
        try {
            const id = await addCustomHoliday(orgId, {
                date: holidayForm.date,
                name: holidayForm.name.trim(),
            });
            setCustomHolidays(prev => [...prev, { id, date: holidayForm.date, name: holidayForm.name.trim() }]);
            setHolidayForm({ date: '', name: '' });
        } catch (err) {
            console.error('휴일 추가 실패:', err);
            showToast('휴일 추가에 실패했습니다.', 'error');
        } finally {
            setAddingHoliday(false);
        }
    };

    const handleDeleteHoliday = async (holidayId: string) => {
        if (!orgId) return;
        if (!await confirm({ message: '이 휴일을 삭제하시겠습니까?', confirmColor: 'danger' })) return;
        try {
            await deleteCustomHoliday(orgId, holidayId);
            setCustomHolidays(prev => prev.filter(h => h.id !== holidayId));
        } catch (err) {
            console.error('휴일 삭제 실패:', err);
            showToast('휴일 삭제에 실패했습니다.', 'error');
        }
    };

    // ── 출발지(분관) 관리 ─────────────────────────────────────────
    // 본관은 목록에 없다 — 기관 주소가 곧 본관이고 증빙서류에서 온 값이라 여기서 고치지 않는다.
    const handleAddSite = useCallback(() => {
        setForm(prev => ({
            ...prev,
            sites: [...prev.sites, { id: createSiteId(), name: '', address: '' }],
        }));
    }, []);

    const handleSiteChange = useCallback((id: string, patch: Partial<Omit<OrgSite, 'id'>>) => {
        setForm(prev => ({
            ...prev,
            sites: prev.sites.map(site => site.id === id ? { ...site, ...patch } : site),
        }));
    }, []);

    /**
     * 출발지 목록을 저장한다.
     *
     * 기관 정보 폼(handleSave)에 얹지 않고 따로 두는 이유는 **피드백이 누른 자리에 있어야**
     * 하기 때문이다. handleSave는 페이지 최상단 배너로만 성공을 알리는데, 출발지 카드는
     * 스크롤을 내려야 보이는 위치라 모바일에서는 사실상 아무 반응이 없다. 여기서는 토스트로
     * 알리고, 실패하면 화면의 목록을 이전 값으로 되돌린다.
     */
    const persistSites = async (next: OrgSite[], successMessage: string) => {
        if (!orgId) return;
        const prevSites = form.sites;
        setSavingSites(true);
        setForm(prev => ({ ...prev, sites: next }));
        try {
            await updateOrganization(orgId, { sites: next });
            showToast(successMessage, 'success');
        } catch (err) {
            console.error('출발지 저장 실패:', err);
            // 저장이 안 됐는데 화면만 바뀐 채로 두면, 새로고침에서 되살아나 사용자를 속인다.
            setForm(prev => ({ ...prev, sites: prevSites }));
            showToast('출발지 저장에 실패했습니다.', 'error');
        } finally {
            setSavingSites(false);
        }
    };

    /** 저장까지 함께 한다 — 삭제만 로컬에 남으면 새로고침에 되살아나 지운 줄 알았던 출발지가 돌아온다. */
    const handleRemoveSite = async (id: string) => {
        const target = form.sites.find(site => site.id === id);
        // 저장 전에 추가만 해 둔 빈 줄은 확인 없이 지운다(저장도 필요 없다).
        if (!target || (!target.name.trim() && !target.address.trim())) {
            setForm(prev => ({ ...prev, sites: prev.sites.filter(site => site.id !== id) }));
            return;
        }
        if (!await confirm({
            message: '이 출발지를 삭제하시겠습니까?\n이 출발지로 지정된 차량은 본관에서 출발하는 것으로 되돌아갑니다.',
            confirmColor: 'danger',
        })) return;
        await persistSites(form.sites.filter(site => site.id !== id), '출발지를 삭제했습니다.');
    };

    const handleSaveSites = async () => {
        const cleaned = form.sites
            .map(site => ({ id: site.id, name: site.name.trim(), address: site.address.trim() }))
            .filter(site => site.name || site.address);
        if (cleaned.some(site => !site.name)) {
            showToast('출발지 이름을 입력해주세요.', 'warning');
            return;
        }
        await persistSites(cleaned, '출발지를 저장했습니다.');
    };

    return {
        org, orgId, loading, saving, savingSites, success, withdrawing,
        form, setForm,
        // 공휴일
        holidayYear, setHolidayYear,
        holidayForm, setHolidayForm,
        addingHoliday, publicHolidays,
        filteredCustomHolidays,
        // 핸들러
        handleSave, handleRegenCode, handlePhoneChange, handleWithdraw,
        handleAddHoliday, handleDeleteHoliday,
        // 출발지(분관)
        handleAddSite, handleSiteChange, handleRemoveSite, handleSaveSites,
        formatDate: formatDateKr,
    };
}
