/**
 * useSettings — 기관 설정 상태 관리 + 비즈니스 로직
 * Settings에서 추출된 커스텀 훅
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from './useAuth';
import { useToast } from './useToast';
import { getOrganization, updateOrganization, regenerateInviteCode, getCustomHolidays, addCustomHoliday, deleteCustomHoliday } from '../lib/firestore';
import { fetchPublicHolidays, groupHolidaysByMonth } from '../lib/holidayApi';
import { formatDateKr } from '../lib/dateUtils';
import { formatPhoneNumber } from './useOrgApplication';

export default function useSettings() {
    const { userData } = useAuth();
    const { showToast } = useToast();
    const [org, setOrg] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [success, setSuccess] = useState(false);
    const [form, setForm] = useState({ name: '', adminEmail: '', address: '', phone: '', approvalLine: [{ title: '담당' }, { title: '팀장' }] });

    // 공휴일 관리 상태
    const [holidayYear, setHolidayYear] = useState(new Date().getFullYear());
    const [customHolidays, setCustomHolidays] = useState([]);
    const [holidayForm, setHolidayForm] = useState({ date: '', name: '' });
    const [addingHoliday, setAddingHoliday] = useState(false);
    const [publicHolidays, setPublicHolidays] = useState({});

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
                    setOrg(data);
                    setForm({
                        name: data.name || '',
                        adminEmail: data.adminEmail || '',
                        address: data.address || '',
                        phone: formatPhoneNumber(data.phone || ''),
                        approvalLine: data.approvalLine?.length > 0
                            ? data.approvalLine
                            : [{ title: '담당' }, { title: '팀장' }],
                    });
                }
                setCustomHolidays(holidays);
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

    const handleSave = async (e) => {
        if (e) e.preventDefault();
        if (!orgId) return;
        setSaving(true);
        try {
            await updateOrganization(orgId, {
                name: form.name.trim(),
                adminEmail: form.adminEmail.trim(),
                address: form.address.trim(),
                phone: form.phone.trim(),
                approvalLine: form.approvalLine.filter(a => a.title.trim()).map(a => ({ title: a.title.trim() })),
            });
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
    const handlePhoneChange = useCallback((e) => {
        const formatted = formatPhoneNumber(e.target.value);
        setForm(prev => ({ ...prev, phone: formatted }));
    }, []);

    const handleRegenCode = async () => {
        if (!confirm('초대 코드를 재발급하시겠습니까?\n기존 코드는 더 이상 사용할 수 없습니다.')) return;
        try {
            const newCode = await regenerateInviteCode(orgId);
            setOrg(prev => ({ ...prev, inviteCode: newCode }));
        } catch (err) {
            console.error('코드 재발급 실패:', err);
        }
    };

    const handleAddHoliday = async (e) => {
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

    const handleDeleteHoliday = async (holidayId) => {
        if (!confirm('이 휴일을 삭제하시겠습니까?')) return;
        try {
            await deleteCustomHoliday(orgId, holidayId);
            setCustomHolidays(prev => prev.filter(h => h.id !== holidayId));
        } catch (err) {
            console.error('휴일 삭제 실패:', err);
            showToast('휴일 삭제에 실패했습니다.', 'error');
        }
    };



    return {
        org, orgId, loading, saving, success,
        form, setForm,
        // 공휴일
        holidayYear, setHolidayYear,
        holidayForm, setHolidayForm,
        addingHoliday, publicHolidays,
        filteredCustomHolidays,
        // 핸들러
        handleSave, handleRegenCode, handlePhoneChange,
        handleAddHoliday, handleDeleteHoliday,
        formatDate: formatDateKr,
    };
}
