/**
 * useEmployeeManager — 직원 관리 상태 + CRUD 로직
 * EmployeeManager에서 추출된 커스텀 훅
 */
import { useState, useEffect } from 'react';
import { useAuth } from './useAuth';
import { useToast } from './useToast';
import { getOrganizationMembers, getOrganization, regenerateInviteCode, updateUser } from '../lib/firestore';
import { collection, addDoc, doc, deleteDoc as firestoreDeleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { User } from '../types/user';
import type { Organization } from '../types/organization';

export default function useEmployeeManager() {
    const { userData } = useAuth();
    const { showToast } = useToast();
    const [employees, setEmployees] = useState<User[]>([]);
    const [organization, setOrganization] = useState<Organization | null>(null);
    const [loading, setLoading] = useState(true);
    const [showAddForm, setShowAddForm] = useState(false);
    const [newEmployee, setNewEmployee] = useState({ name: '', email: '' });
    const [inviteCodeCopied, setInviteCodeCopied] = useState(false);
    const [regenerating, setRegenerating] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState({ name: '', email: '' });
    const [searchQuery, setSearchQuery] = useState('');

    const orgId = userData?.organizationId;

    const fetchData = async () => {
        if (!orgId) return;
        setLoading(true);
        try {
            const [members, org] = await Promise.all([
                getOrganizationMembers(orgId),
                getOrganization(orgId),
            ]);
            setEmployees(
                members
                    .filter((m) => m.role !== 'superAdmin')
                    .sort((a, b) => {
                        if (a.role === 'admin' && b.role !== 'admin') return -1;
                        if (a.role !== 'admin' && b.role === 'admin') return 1;
                        return (a.name || '').localeCompare(b.name || '');
                    }) as User[]
            );
            setOrganization(org as Organization | null);
        } catch (err) {
            console.error('데이터 로드 실패:', err);
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
        try {
            await addDoc(collection(db, 'organizations', orgId!, 'preRegistered'), {
                name: newEmployee.name.trim(),
                email: newEmployee.email.trim().toLowerCase(),
                createdAt: serverTimestamp(),
            });
            setNewEmployee({ name: '', email: '' });
            setShowAddForm(false);
            await fetchData();
        } catch (err) {
            console.error('직원 추가 실패:', err);
        }
    };

    const handleCopyInviteCode = async () => {
        if (!organization?.inviteCode) return;
        try {
            await navigator.clipboard.writeText(organization.inviteCode);
            setInviteCodeCopied(true);
            setTimeout(() => setInviteCodeCopied(false), 2000);
        } catch {
            const textArea = document.createElement('textarea');
            textArea.value = organization.inviteCode;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            setInviteCodeCopied(true);
            setTimeout(() => setInviteCodeCopied(false), 2000);
        }
    };

    const handleRegenerateCode = async () => {
        if (!confirm('초대 코드를 재발급하시겠습니까?\n기존 코드는 더 이상 사용할 수 없습니다.')) return;
        setRegenerating(true);
        try {
            const newCode = await regenerateInviteCode(orgId!);
            setOrganization(prev => prev ? ({ ...prev, inviteCode: newCode }) : null);
        } catch (err) {
            console.error('코드 재발급 실패:', err);
        } finally {
            setRegenerating(false);
        }
    };

    const handleEditEmployee = (emp: User) => {
        setEditingId(emp.id);
        setEditForm({ name: emp.name || '', email: emp.email || '' });
    };

    const handleSaveEdit = async (empId: string) => {
        try {
            await updateUser(empId, { name: editForm.name.trim() });
            setEditingId(null);
            await fetchData();
        } catch (err) {
            console.error('수정 실패:', err);
        }
    };

    const handleDeleteEmployee = async (emp: User) => {
        // 자기 자신 삭제 금지
        if (emp.id === userData?.uid) {
            showToast('자기 자신은 삭제할 수 없습니다.', 'warning');
            return;
        }
        if (!confirm(`${emp.name || emp.email} 직원을 삭제하시겠습니까?`)) return;
        try {
            await firestoreDeleteDoc(doc(db, 'users', emp.id));
            await fetchData();
        } catch (err) {
            console.error('삭제 실패:', err);
        }
    };

    const handleChangeRole = async (emp: User, newRole: string) => {
        // 자기 자신 역할 변경 금지
        if (emp.id === userData?.uid) {
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
        try {
            await updateUser(emp.id, { role: newRole });
            await fetchData();
        } catch (err) {
            console.error('역할 변경 실패:', err);
        }
    };

    const filteredEmployees = employees.filter(emp => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return emp.name?.toLowerCase().includes(q) || emp.email?.toLowerCase().includes(q);
    });

    const admins = employees.filter(e => e.role === 'admin');
    const regularEmployees = employees.filter(e => e.role === 'employee');

    return {
        employees, organization, loading,
        showAddForm, setShowAddForm,
        newEmployee, setNewEmployee,
        inviteCodeCopied, regenerating,
        editingId, setEditingId, editForm, setEditForm,
        searchQuery, setSearchQuery,
        filteredEmployees, admins, regularEmployees,
        handleAddEmployee, handleCopyInviteCode, handleRegenerateCode,
        handleEditEmployee, handleSaveEdit, handleDeleteEmployee, handleChangeRole,
    };
}
