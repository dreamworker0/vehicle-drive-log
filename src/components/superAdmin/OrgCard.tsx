/**
 * OrgCard — 활성 기관 카드 (OrgManagement에서 분리)
 * 기관명·주소 인라인 편집 지원
 */
import { useState } from 'react';
import { formatTimestampFull } from '../../lib/dateUtils';
import type { Organization } from '../../types';

interface OrgMember {
    id: string;
    name?: string;
    email?: string;
    role?: string;
}

interface OrgCardProps {
    org: Organization;
    members: OrgMember[];
    isExpanded: boolean;
    changingRole: string | null;
    onToggle: (orgId: string) => void;
    onDelete: (org: Organization) => void;
    onEditOrg: (orgId: string, updates: { name: string; address: string }) => Promise<void>;
    onRoleChange: (member: OrgMember, orgId: string, newRole: string) => void;
    onRemoveMember: (member: OrgMember, orgId: string) => void;
}


export default function OrgCard({
    org, members, isExpanded, changingRole,
    onToggle, onDelete, onEditOrg, onRoleChange, onRemoveMember,
}: OrgCardProps) {
    // 익명 계정 필터링 (이름이 없거나 '-'인 계정 제외)
    const visibleMembers = members.filter(m => m.name && m.name !== '-');

    // 인라인 편집 상태
    const [editing, setEditing] = useState(false);
    const [editForm, setEditForm] = useState({ name: '', address: '' });
    const [saving, setSaving] = useState(false);

    const startEdit = (e: React.MouseEvent) => {
        e.stopPropagation();
        setEditForm({ name: org.name || '', address: org.address || '' });
        setEditing(true);
    };

    const cancelEdit = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        setEditing(false);
    };

    const saveEdit = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!editForm.name.trim()) return;
        setSaving(true);
        try {
            await onEditOrg(org.id, {
                name: editForm.name.trim(),
                address: editForm.address.trim(),
            });
            setEditing(false);
        } catch {
            // 에러는 부모에서 toast 처리
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="glass-card overflow-hidden transition-shadow hover:shadow-glass-lg">
            <div className="p-5">
                <div className="flex items-start justify-between">
                    <div
                        className="space-y-2 flex-1 cursor-pointer"
                        onClick={() => !editing && onToggle(org.id)}
                    >
                        {editing ? (
                            /* 인라인 편집 모드 */
                            <div className="space-y-3" onClick={e => e.stopPropagation()}>
                                <div>
                                    <label className="text-xs font-medium text-surface-500 dark:text-surface-400 mb-1 block">기관명 <span className="text-red-500">*</span></label>
                                    <input
                                        type="text"
                                        value={editForm.name}
                                        onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                                        className="input text-sm"
                                        placeholder="기관명"
                                        autoFocus
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-surface-500 dark:text-surface-400 mb-1 block">주소</label>
                                    <input
                                        type="text"
                                        value={editForm.address}
                                        onChange={e => setEditForm(prev => ({ ...prev, address: e.target.value }))}
                                        className="input text-sm"
                                        placeholder="주소"
                                    />
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={saveEdit}
                                        disabled={saving || !editForm.name.trim()}
                                        className="btn-primary btn-sm text-xs"
                                    >
                                        {saving ? (<><div className="w-3 h-3 spinner" />저장 중...</>) : '저장'}
                                    </button>
                                    <button
                                        onClick={cancelEdit}
                                        disabled={saving}
                                        className="btn-ghost btn-sm text-xs"
                                    >
                                        취소
                                    </button>
                                </div>
                            </div>
                        ) : (
                            /* 기본 표시 모드 */
                            <>
                                <div className="flex items-center gap-2">
                                    <h3 className="text-lg font-semibold text-surface-900 dark:text-surface-100">{org.name}</h3>
                                    <button
                                        onClick={startEdit}
                                        className="p-1 rounded-lg text-surface-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors"
                                        title="기관명·주소 편집"
                                    >
                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                                        </svg>
                                    </button>
                                    <svg
                                        className={`w-4 h-4 text-surface-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                                        fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                                    >
                                        <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                                    </svg>
                                </div>
                                <div className="flex flex-wrap gap-3 text-sm text-surface-500 dark:text-surface-400">
                                    <span>고유번호: {org.uniqueNumber}</span>
                                    <span>•</span>
                                    <span>직원 {visibleMembers.length}명</span>
                                    <span>•</span>
                                    <span>초대코드: <code className="bg-surface-100 dark:bg-surface-700 px-1.5 py-0.5 rounded text-primary-700 dark:text-primary-300 font-mono text-xs">{org.inviteCode}</code></span>
                                    {formatTimestampFull(org.approvedAt) && (
                                        <>
                                            <span>•</span>
                                            <span>승인일시: {formatTimestampFull(org.approvedAt)}</span>
                                        </>
                                    )}
                                </div>
                                {org.address && (
                                    <p className="text-sm text-surface-400">{org.address}</p>
                                )}
                                {(org.applicantName || org.applicantEmail || org.applicantPhone) && (
                                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-surface-500 dark:text-surface-400 mt-1 pt-1 border-t border-surface-100 dark:border-surface-700">
                                        {org.applicantName && (
                                            <span className="flex items-center gap-1">
                                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0" />
                                                </svg>
                                                {org.applicantName}
                                            </span>
                                        )}
                                        {org.applicantPhone && (
                                            <span className="flex items-center gap-1">
                                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
                                                </svg>
                                                {org.applicantPhone}
                                            </span>
                                        )}
                                        {org.applicantEmail && (
                                            <span className="flex items-center gap-1">
                                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                                                </svg>
                                                {org.applicantEmail}
                                            </span>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                    <button
                        onClick={() => onDelete(org)}
                        className="btn-ghost btn-sm text-red-500 hover:text-red-600 hover:bg-red-50"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                        </svg>
                    </button>
                </div>
            </div>

            {isExpanded && (
                <div className="border-t border-surface-100 dark:border-surface-700 bg-surface-50/50 dark:bg-surface-800/50">
                    {visibleMembers.length === 0 ? (
                        <div className="p-4 text-center text-sm text-surface-400">
                            소속된 멤버가 없습니다
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-surface-200 dark:border-surface-600 text-surface-500 dark:text-surface-400">
                                        <th className="text-left py-2.5 px-5 font-medium">이름</th>
                                        <th className="text-left py-2.5 px-5 font-medium">이메일</th>
                                        <th className="text-left py-2.5 px-5 font-medium">구분</th>
                                        <th className="text-center py-2.5 px-3 font-medium w-16">관리</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {visibleMembers
                                        .sort((a, b) => {
                                            if (a.role === 'admin' && b.role !== 'admin') return -1;
                                            if (a.role !== 'admin' && b.role === 'admin') return 1;
                                            return (a.name || '').localeCompare(b.name || '');
                                        })
                                        .map((member) => (
                                            <tr key={member.id} className="border-b border-surface-100 dark:border-surface-700 last:border-b-0 hover:bg-surface-100/50 dark:hover:bg-surface-700/50 transition-colors">
                                                <td className="py-2.5 px-5 text-surface-800 dark:text-surface-200 font-medium">{member.name || '-'}</td>
                                                <td className="py-2.5 px-5 text-surface-500 dark:text-surface-400">{member.email || '-'}</td>
                                                <td className="py-2.5 px-5">
                                                    <select
                                                        value={member.role || 'employee'}
                                                        onChange={(e) => onRoleChange(member, org.id, e.target.value)}
                                                        disabled={changingRole === member.id}
                                                        className={`text-xs border border-surface-200 dark:border-surface-600 rounded-lg px-2 py-1 bg-white dark:bg-surface-800 text-surface-600 dark:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 cursor-pointer transition-colors ${changingRole === member.id ? 'opacity-50' : ''}`}
                                                    >
                                                        <option value="admin">기관관리자</option>
                                                        <option value="employee">직원</option>
                                                    </select>
                                                </td>
                                                <td className="py-2.5 px-3 text-center">
                                                    <button
                                                        onClick={() => onRemoveMember(member, org.id)}
                                                        className="btn-icon btn-sm text-surface-400 hover:text-red-500 transition-colors"
                                                        title="직원 제거"
                                                    >
                                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                                        </svg>
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
