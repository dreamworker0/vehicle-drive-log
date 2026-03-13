/**
 * OrgManagement — 기관 관리 페이지
 * 활성 기관 카드: OrgCard, 삭제된 기관 카드: DeletedOrgCard 서브 컴포넌트 사용
 */
import { useState, useEffect } from 'react';
import { getApprovedOrganizations, deleteOrganization, getDeletedOrganizations, restoreOrganization, permanentDeleteOrganization, getOrganizationMembers, updateUser, leaveOrganization, updateOrganization } from '../../lib/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useToast } from '../../hooks/useToast';
import { useConfirm } from '../../contexts/ConfirmContext';
import OrgCard from './OrgCard';
import DeletedOrgCard from './DeletedOrgCard';
import type { Organization } from '../../types';

export default function OrgManagement() {
    const [organizations, setOrganizations] = useState<Organization[]>([]);
    const [deletedOrgs, setDeletedOrgs] = useState<Organization[]>([]);
    const [loading, setLoading] = useState(true);
    const [membersMap, setMembersMap] = useState<Record<string, any[]>>({});
    const [expandedOrg, setExpandedOrg] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [changingRole, setChangingRole] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'active' | 'inactive' | 'deleted'>('active');
    const [deletingOrgId, setDeletingOrgId] = useState<string | null>(null);
    const { showToast } = useToast();
    const { confirm } = useConfirm();

    const fetchOrganizations = async () => {
        setLoading(true);
        try {
            const [orgs, deleted] = await Promise.all([
                getApprovedOrganizations(),
                getDeletedOrganizations().catch((err: any) => {
                    console.warn('삭제된 기관 목록 로드 실패 (인덱스 빌드 중일 수 있음):', err);
                    return [];
                }),
            ]);
            setOrganizations(orgs as Organization[]);
            setDeletedOrgs(deleted as Organization[]);

            const mMap: Record<string, any[]> = {};
            await Promise.all(
                (orgs as Organization[]).map(async (org) => {
                    const members = await getOrganizationMembers(org.id);
                    mMap[org.id] = members as any[];
                })
            );
            setMembersMap(mMap);
        } catch (err) {
            console.error('기관 목록 로드 실패:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchOrganizations();
    }, []);

    const handleDelete = async (org: Organization) => {
        if (!await confirm({ message: `${org.name} 기관을 삭제하시겠습니까?\n\n• 30일 내 복구 가능합니다.\n• 소속 직원은 기능 접근이 차단됩니다.`, confirmColor: 'danger' })) return;
        try {
            await deleteOrganization(org.id);
            showToast('기관이 삭제되었습니다. 30일 내 복구 가능합니다.', 'success');
            await fetchOrganizations();
        } catch (err) {
            console.error('삭제 실패:', err);
            showToast('삭제에 실패했습니다.', 'error');
        }
    };

    const handleRestore = async (org: Organization) => {
        if (!await confirm({ message: `${org.name} 기관을 복구하시겠습니까?` })) return;
        try {
            await restoreOrganization(org.id);
            showToast('기관이 복구되었습니다.', 'success');
            await fetchOrganizations();
        } catch (err) {
            console.error('복구 실패:', err);
            showToast('복구에 실패했습니다.', 'error');
        }
    };

    const handlePermanentDelete = async (org: Organization) => {
        if (!await confirm({ title: '⚠️ 영구 삭제', message: `${org.name} 기관을 영구 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.\n소속된 모든 사용자 계정도 함께 삭제됩니다.`, confirmText: '영구 삭제', confirmColor: 'danger' })) return;
        if (!await confirm({ message: '정말로 영구 삭제를 진행하시겠습니까? 마지막 확인입니다.', confirmText: '확인', confirmColor: 'danger' })) return;
        setDeletingOrgId(org.id);
        try {
            await permanentDeleteOrganization(org.id);
            showToast('기관이 영구 삭제되었습니다.', 'success');
            await fetchOrganizations();
        } catch (err) {
            console.error('영구 삭제 실패:', err);
            showToast('영구 삭제에 실패했습니다.', 'error');
        } finally {
            setDeletingOrgId(null);
        }
    };

    const handleRoleChange = async (member: any, orgId: string, newRole: string) => {
        if (member.role === newRole) return;
        const roleLabel = newRole === 'admin' ? '기관관리자' : '직원';
        if (!await confirm({ message: `${member.name || member.email}의 역할을 "${roleLabel}"(으)로 변경하시겠습니까?` })) return;

        setChangingRole(member.id);
        try {
            await updateUser(member.id, { role: newRole });
            setMembersMap(prev => ({
                ...prev,
                [orgId]: prev[orgId].map((m: any) =>
                    m.id === member.id ? { ...m, role: newRole } : m
                )
            }));
        } catch (err) {
            console.error('역할 변경 실패:', err);
            showToast('역할 변경에 실패했습니다.', 'error');
        } finally {
            setChangingRole(null);
        }
    };

    const handleRemoveMember = async (member: any, orgId: string) => {
        if (!await confirm({ message: `${member.name || member.email || '이 사용자'}를 기관에서 제거하시겠습니까?\n\n제거된 사용자는 초대 코드를 통해 다시 가입할 수 있습니다.`, confirmColor: 'danger' })) return;
        try {
            await leaveOrganization(member.id);
            setMembersMap(prev => ({
                ...prev,
                [orgId]: prev[orgId].filter((m: any) => m.id !== member.id)
            }));
            showToast('직원이 제거되었습니다.', 'success');
        } catch (err) {
            console.error('직원 제거 실패:', err);
            showToast('직원 제거에 실패했습니다.', 'error');
        }
    };

    const handleEditOrg = async (orgId: string, updates: { name: string; address: string }) => {
        try {
            await updateOrganization(orgId, updates as any);
            setOrganizations(prev => prev.map(o =>
                o.id === orgId ? { ...o, ...updates } : o
            ));
            showToast('기관 정보가 수정되었습니다.', 'success');
        } catch (err) {
            console.error('기관 정보 수정 실패:', err);
            showToast('기관 정보 수정에 실패했습니다.', 'error');
            throw err;
        }
    };

    const handleRestoreUser = async (email: string, orgId: string, name: string) => {
        if (!await confirm({ message: `${email} 계정을 복원하시겠습니까?\n\n• Auth 계정이 다시 활성화됩니다.\n• 이 기관의 직원으로 복원됩니다.` })) return;
        try {
            const restoreUser = httpsCallable(getFunctions(undefined, 'asia-northeast3'), 'restoreUser');
            const result = await restoreUser({ email, organizationId: orgId, name: name || undefined });
            const data = result.data as any;
            // 멤버 목록에 추가
            setMembersMap(prev => ({
                ...prev,
                [orgId]: [...(prev[orgId] || []), { id: data.uid, name: data.name, email: data.email, role: 'employee' }]
            }));
            showToast(`${data.name || email} 계정이 복원되었습니다.`, 'success');
        } catch (err: any) {
            console.error('계정 복원 실패:', err);
            const msg = err?.message || err?.code || '계정 복원에 실패했습니다.';
            showToast(msg, 'error');
            throw err;
        }
    };

    const toggleExpand = (orgId: string) => {
        setExpandedOrg(prev => prev === orgId ? null : orgId);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 spinner" />
            </div>
        );
    }

    // 직원 0명 기관 (익명 계정 제외)
    const inactiveOrgs = organizations.filter(org => {
        const members = membersMap[org.id] || [];
        const visible = members.filter(m => m.name && m.name !== '-');
        return visible.length === 0;
    });

    // 검색 기준 목록 결정
    const baseOrgs = activeTab === 'inactive' ? inactiveOrgs : organizations;

    // 검색 필터
    const filteredOrgs = baseOrgs.filter(org => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
            org.name?.toLowerCase().includes(q) ||
            org.uniqueNumber?.toLowerCase().includes(q) ||
            org.address?.toLowerCase().includes(q) ||
            org.applicantName?.toLowerCase().includes(q) ||
            org.applicantEmail?.toLowerCase().includes(q) ||
            org.applicantPhone?.includes(q) ||
            org.inviteCode?.toLowerCase().includes(q)
        );
    });

    return (
        <div className="max-w-4xl mx-auto animate-fade-in">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">기관 관리</h1>
                <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">승인된 기관 목록을 관리하세요</p>
            </div>

            {/* 탭 */}
            <div className="flex gap-1 mb-4 bg-surface-100 dark:bg-surface-800 rounded-xl p-1">
                <button
                    onClick={() => setActiveTab('active')}
                    className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all
                        ${activeTab === 'active' ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-surface-100 shadow-sm' : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:text-surface-300'}`}
                >
                    활성 기관 ({organizations.length})
                </button>
                <button
                    onClick={() => setActiveTab('inactive')}
                    className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all
                        ${activeTab === 'inactive' ? 'bg-white dark:bg-surface-700 text-amber-600 dark:text-amber-400 shadow-sm' : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:text-surface-300'}`}
                >
                    미활성 기관 ({inactiveOrgs.length})
                </button>
                <button
                    onClick={() => setActiveTab('deleted')}
                    className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all
                        ${activeTab === 'deleted' ? 'bg-white dark:bg-surface-700 text-red-600 dark:text-red-400 shadow-sm' : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:text-surface-300'}`}
                >
                    삭제된 기관 ({deletedOrgs.length})
                </button>
            </div>

            {/* 검색 */}
            {(activeTab === 'active' || activeTab === 'inactive') && baseOrgs.length > 0 && (
                <div className="mb-4">
                    <div className="relative">
                        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                        </svg>
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="input pl-10"
                            placeholder="기관명, 고유번호, 주소, 신청자 검색"
                        />
                    </div>
                </div>
            )}

            {/* 활성/미활성 기관 탭 */}
            {(activeTab === 'active' || activeTab === 'inactive') && (
                baseOrgs.length === 0 ? (
                    <div className="glass-card p-12 text-center">
                        {activeTab === 'inactive' ? (
                            <>
                                <div className="text-4xl mb-3">🎉</div>
                                <p className="text-surface-400 text-lg font-medium">모든 기관에 직원이 등록되어 있습니다</p>
                            </>
                        ) : (
                            <>
                                <svg className="w-16 h-16 mx-auto text-surface-200 mb-4" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5M3.75 3v18m16.5-18v18M5.25 3h13.5M5.25 21h13.5" />
                                </svg>
                                <p className="text-surface-400 text-lg font-medium">등록된 기관이 없습니다</p>
                            </>
                        )}
                    </div>
                ) : filteredOrgs.length === 0 ? (
                    <div className="glass-card p-12 text-center">
                        <div className="text-4xl mb-3">🔍</div>
                        <p className="text-surface-400 font-medium">검색 결과가 없습니다</p>
                    </div>
                ) : (
                    <div className="grid gap-4">
                        {filteredOrgs.map((org) => (
                            <OrgCard
                                key={org.id}
                                org={org}
                                members={membersMap[org.id] || []}
                                isExpanded={expandedOrg === org.id}
                                changingRole={changingRole}
                                onToggle={toggleExpand}
                                onDelete={handleDelete}
                                onEditOrg={handleEditOrg}
                                onRoleChange={handleRoleChange}
                                onRemoveMember={handleRemoveMember}
                                onRestoreUser={handleRestoreUser}
                            />
                        ))}
                    </div>
                )
            )}

            {/* 삭제된 기관 탭 */}
            {activeTab === 'deleted' && (
                deletedOrgs.length === 0 ? (
                    <div className="glass-card p-12 text-center">
                        <div className="text-4xl mb-3">✨</div>
                        <p className="text-surface-400 font-medium">삭제된 기관이 없습니다</p>
                    </div>
                ) : (
                    <div className="grid gap-4">
                        {deletedOrgs.map((org) => (
                            <DeletedOrgCard
                                key={org.id}
                                org={org}
                                isDeleting={deletingOrgId === org.id}
                                onRestore={handleRestore}
                                onPermanentDelete={handlePermanentDelete}
                            />
                        ))}
                    </div>
                )
            )}
        </div>
    );
}
