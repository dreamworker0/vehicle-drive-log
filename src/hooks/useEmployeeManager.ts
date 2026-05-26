/**
 * useEmployeeManager — 직원 관리 상태 + CRUD 로직
 * EmployeeManager에서 추출된 커스텀 훅
 */
import { useState, useEffect } from 'react';
import { useAuth } from './useAuth';
import { useToast } from './useToast';
import { useConfirm } from './useConfirm';
import useRetry from './useRetry';
import { getOrganizationMembers, getOrganization, regenerateInviteCode, updateUser } from '../lib/firestore';
import { collection, addDoc, getDocs, deleteDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { User, UserRole } from '../types/user';
import type { Organization } from '../types/organization';
import { captureError } from '../lib/sentry';

export default function useEmployeeManager() {
    const { userData } = useAuth();
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const { runWithRetry } = useRetry();
    const [employees, setEmployees] = useState<User[]>([]);
    const [disabledEmployees, setDisabledEmployees] = useState<User[]>([]);
    const [preRegisteredEmployees, setPreRegisteredEmployees] = useState<{ id: string; name: string; email: string; createdAt: unknown }[]>([]);
    const [organization, setOrganization] = useState<Organization | null>(null);
    const [loading, setLoading] = useState(true);
    const [showAddForm, setShowAddForm] = useState(false);
    const [newEmployee, setNewEmployee] = useState({ name: '', email: '' });
    const [copiedType, setCopiedType] = useState<'none' | 'link' | 'code'>('none');
    const [regenerating, setRegenerating] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState({ name: '', email: '' });
    const [searchQuery, setSearchQuery] = useState('');

    const orgId = userData?.organizationId;

    const fetchData = async () => {
        if (!orgId) return;
        setLoading(true);
        try {
            const [members, org, preRegSnap] = await Promise.all([
                getOrganizationMembers(orgId),
                getOrganization(orgId),
                getDocs(collection(db, 'organizations', orgId, 'preRegistered')),
            ]);
            const nonSuperAdmins = members.filter((m) => m.role !== 'superAdmin');
            const activeMembers = nonSuperAdmins.filter((m) => m.status !== 'disabled');
            const disabledMembers = nonSuperAdmins.filter((m) => m.status === 'disabled');
            setEmployees(
                activeMembers.sort((a, b) => {
                    if (a.role === 'admin' && b.role !== 'admin') return -1;
                    if (a.role !== 'admin' && b.role === 'admin') return 1;
                    return (a.name || '').localeCompare(b.name || '');
                }) as User[]
            );
            setDisabledEmployees(
                disabledMembers.sort((a, b) => (a.name || '').localeCompare(b.name || '')) as User[]
            );
            setPreRegisteredEmployees(
                preRegSnap.docs.map(d => ({ id: d.id, ...d.data() } as { id: string; name: string; email: string; createdAt: unknown }))
                    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
            );
            setOrganization(org as Organization | null);
        } catch (err) {
            console.error('데이터 로드 실패:', err);
            captureError(err, { context: 'useEmployeeManager.fetchData', orgId });
        } finally {
            setLoading(false);
        }
    };

    /* eslint-disable react-hooks/exhaustive-deps */
    useEffect(() => { fetchData(); }, [orgId]);
    /* eslint-enable react-hooks/exhaustive-deps */

    const handleAddEmployee = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!newEmployee.name.trim()) return;
        await runWithRetry('add-emp', async () => {
            await addDoc(collection(db, 'organizations', orgId!, 'preRegistered'), {
                name: newEmployee.name.trim(),
                email: newEmployee.email.trim().toLowerCase(),
                createdAt: serverTimestamp(),
            });
            setNewEmployee({ name: '', email: '' });
            setShowAddForm(false);
            await fetchData();
        }, { errorMessage: '직원 추가에 실패했습니다.' });
    };

    const handleCopyInviteCode = async (type: 'link' | 'code' = 'link') => {
        if (!organization?.inviteCode) return;
        const textToCopy = type === 'link' 
            ? `https://vehicle-drive-log.web.app?code=${organization.inviteCode}`
            : organization.inviteCode;
            
        try {
            await navigator.clipboard.writeText(textToCopy);
            setCopiedType(type);
            setTimeout(() => setCopiedType('none'), 2000);
        } catch {
            const textArea = document.createElement('textarea');
            textArea.value = textToCopy;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            setCopiedType(type);
            setTimeout(() => setCopiedType('none'), 2000);
        }
    };

    const handleRegenerateCode = async () => {
        if (!await confirm({ message: '초대 코드를 재발급하시겠습니까?\n기존 코드는 더 이상 사용할 수 없습니다.', confirmColor: 'warning' })) return;
        setRegenerating(true);
        await runWithRetry('regen-code', async () => {
            const newCode = await regenerateInviteCode(orgId!);
            setOrganization(prev => prev ? ({ ...prev, inviteCode: newCode }) : null);
        }, { errorMessage: '코드 재발급에 실패했습니다.' });
        setRegenerating(false);
    };

    const handleEditEmployee = (emp: User) => {
        setEditingId(emp.id);
        setEditForm({ name: emp.name || '', email: emp.email || '' });
    };

    const handleSaveEdit = async (empId: string) => {
        await runWithRetry(`save-edit-${empId}`, async () => {
            await updateUser(empId, { name: editForm.name.trim() });
            setEditingId(null);
            await fetchData();
        }, { errorMessage: '수정에 실패했습니다.' });
    };

    const handleDeleteEmployee = async (emp: User) => {
        // 안전 검증: 세션 유저 정보가 아직 로드되지 않은 경우 동작 차단
        if (!userData?.id) {
            showToast('사용자 정보를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.', 'warning');
            return;
        }
        // 자기 자신 삭제 금지
        if (emp.id === userData.id) {
            showToast('자기 자신은 비활성화할 수 없습니다.', 'warning');
            return;
        }
        if (!await confirm({ message: `${emp.name || emp.email} 직원을 비활성화하시겠습니까?\n\n비활성 직원은 앱 이용이 차단됩니다.`, confirmColor: 'danger' })) return;
        
        await runWithRetry(`disable-emp-${emp.id}`, async () => {
            const { getFunctions, httpsCallable } = await import('firebase/functions');
            const functions = getFunctions(undefined, 'asia-northeast3');
            const callable = httpsCallable(functions, 'disableUser');
            await callable({ uid: emp.id });
            showToast('직원이 비활성화되었습니다.', 'success');
            await fetchData();
        }, {
            errorMessage: '비활성화에 실패했습니다.',
            useBackoff: true,
            onError: (err: unknown) => {
                const message = err instanceof Error ? err.message : null;
                if (message && !message.toLowerCase().includes('network')) {
                    showToast(message, 'error');
                    return true;
                }
            }
        });
    };

    const handleRestoreEmployee = async (emp: User) => {
        if (!await confirm({ message: `${emp.name || emp.email} 직원을 다시 활성화하시겠습니까?` })) return;
        await runWithRetry(`restore-emp-${emp.id}`, async () => {
            await updateDoc(doc(db, 'users', emp.id), { status: 'active', disabledAt: null });
            showToast('직원이 활성화되었습니다.', 'success');
            await fetchData();
        }, { errorMessage: '활성화에 실패했습니다.' });
    };

    const handleChangeRole = async (emp: User, newRole: UserRole) => {
        // 자기 자신 역할 변경 금지
        if (emp.id === userData?.id) {
            showToast('자신의 역할은 변경할 수 없습니다.', 'warning');
            await fetchData(); // select 원래 값으로 복원
            return;
        }
        // 마지막 admin 강등 금지
        if (newRole === 'employee' && emp.role === 'admin') {
            const adminCount = employees.filter(e => e.role === 'admin').length;
            if (adminCount <= 1) {
                showToast('관리자는 최소 1명이 있어야 합니다.', 'warning');
                await fetchData(); // select 원래 값으로 복원
                return;
            }
        }
        await runWithRetry(`change-role-${emp.id}`, async () => {
            await updateUser(emp.id, { role: newRole });
            await fetchData();
        }, { errorMessage: '역할 변경에 실패했습니다.' });
    };

    const handleDeletePreRegistered = async (preRegId: string) => {
        if (!orgId) return;
        if (!await confirm({ message: '사전 등록을 취소하시겠습니까?', confirmColor: 'warning' })) return;
        await runWithRetry(`del-prereg-${preRegId}`, async () => {
            await deleteDoc(doc(db, 'organizations', orgId, 'preRegistered', preRegId));
            showToast('사전 등록이 취소되었습니다.', 'success');
            await fetchData();
        }, { errorMessage: '삭제에 실패했습니다.' });
    };

    const filteredEmployees = employees.filter(emp => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return emp.name?.toLowerCase().includes(q) || emp.email?.toLowerCase().includes(q);
    });

    const admins = employees.filter(e => e.role === 'admin');
    const regularEmployees = employees.filter(e => e.role === 'employee');

    // ── 통합 목록: 활성 + 가입대기 + 비활성 ──
    type MemberStatus = 'active' | 'pending' | 'disabled';
    interface UnifiedMember {
        id: string;
        name: string;
        email: string;
        role?: string;
        memberStatus: MemberStatus;
        original: User; // 원본 데이터 참조 (가입대기는 사용하지 않음)
    }

    const unifiedList: UnifiedMember[] = [
        // 1) 활성 직원 — 관리자 먼저, 이름순
        ...employees.map(emp => ({
            id: emp.id,
            name: emp.name || '',
            email: emp.email || '',
            role: emp.role,
            memberStatus: 'active' as MemberStatus,
            original: emp,
        })),
        // 2) 가입 대기
        ...preRegisteredEmployees.map(pre => ({
            id: pre.id,
            name: pre.name || '',
            email: pre.email || '',
            role: undefined,
            memberStatus: 'pending' as MemberStatus,
            original: pre as User,
        })),
        // 3) 비활성 직원
        ...disabledEmployees.map(emp => ({
            id: emp.id,
            name: emp.name || '',
            email: emp.email || '',
            role: emp.role,
            memberStatus: 'disabled' as MemberStatus,
            original: emp,
        })),
    ];

    // 통합 검색
    const filteredUnifiedList = unifiedList.filter(m => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
    });

    // 상태별 통계
    const stats = {
        total: employees.length + preRegisteredEmployees.length + disabledEmployees.length,
        active: employees.length,
        pending: preRegisteredEmployees.length,
        disabled: disabledEmployees.length,
        admins: admins.length,
        regularEmployees: regularEmployees.length,
    };

    return {
        employees, disabledEmployees, preRegisteredEmployees, organization, loading,
        showAddForm, setShowAddForm,
        newEmployee, setNewEmployee,
        copiedType, regenerating,
        editingId, setEditingId, editForm, setEditForm,
        searchQuery, setSearchQuery,
        filteredEmployees, admins, regularEmployees,
        unifiedList, filteredUnifiedList, stats,
        handleAddEmployee, handleCopyInviteCode, handleRegenerateCode,
        handleEditEmployee, handleSaveEdit, handleDeleteEmployee, handleChangeRole,
        handleDeletePreRegistered, handleRestoreEmployee,
    };
}
