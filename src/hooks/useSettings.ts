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
    driverAllowList: boolean;
    driverAllowSearch: boolean;
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
        driverAllowList: true,
        driverAllowSearch: true,
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
                        driverAllowList: features.driverAllowList,
                        driverAllowSearch: features.driverAllowSearch,
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
        if (overrides) {
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
                    driverAllowList: targetData.driverAllowList,
                    driverAllowSearch: targetData.driverAllowSearch,
                });
            }
            setSuccess(true);
            setTimeout(() => setSuccess(false), 3000);
        } catch (err) {
            console.error('저장 실패:', err);
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

    return {
        org, orgId, loading, saving, success, withdrawing,
        form, setForm,
        // 공휴일
        holidayYear, setHolidayYear,
        holidayForm, setHolidayForm,
        addingHoliday, publicHolidays,
        filteredCustomHolidays,
        // 핸들러
        handleSave, handleRegenCode, handlePhoneChange, handleWithdraw,
        handleAddHoliday, handleDeleteHoliday,
        formatDate: formatDateKr,
    };
}
