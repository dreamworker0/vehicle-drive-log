/**
 * OrgMemberTable — 기관 멤버 목록 테이블 (역할 변경·제거)
 */
import { memo } from 'react';

interface OrgMember {
    id: string;
    name?: string;
    email?: string;
    role?: string;
    [key: string]: unknown;
}

interface Props {
    members: OrgMember[];
    orgId: string;
    changingRole: string | null;
    loadingMembers: boolean;
    onRoleChange: (member: OrgMember, orgId: string, newRole: string) => void;
    onRemoveMember: (member: OrgMember, orgId: string) => void;
}

export default memo(function OrgMemberTable({ members, orgId, changingRole, loadingMembers, onRoleChange, onRemoveMember }: Props) {
    // 익명 계정 필터링 (이름이 없거나 '-'인 계정 제외)
    const visibleMembers = members.filter(m => m.name && m.name !== '-');

    if (loadingMembers) {
        return (
            <div className="p-6 flex items-center justify-center gap-2 text-sm text-surface-400 dark:text-surface-500">
                <div className="w-4 h-4 spinner" />
                멤버 정보 불러오는 중...
            </div>
        );
    }

    if (visibleMembers.length === 0) {
        return (
            <div className="p-4 text-center text-sm text-surface-400 dark:text-surface-500">
                소속된 멤버가 없습니다
            </div>
        );
    }

    const sortedMembers = [...visibleMembers].sort((a, b) => {
        if (a.role === 'admin' && b.role !== 'admin') return -1;
        if (a.role !== 'admin' && b.role === 'admin') return 1;
        return (a.name || '').localeCompare(b.name || '');
    });

    return (
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
                    {sortedMembers.map((member) => (
                        <tr key={member.id} className="border-b border-surface-100 dark:border-surface-700 last:border-b-0 hover:bg-surface-100/50 dark:hover:bg-surface-700/50 transition-colors">
                            <td className="py-2.5 px-5 text-surface-800 dark:text-surface-200 font-medium">{member.name || '-'}</td>
                            <td className="py-2.5 px-5 text-surface-500 dark:text-surface-400">{member.email || '-'}</td>
                            <td className="py-2.5 px-5">
                                <select
                                    value={member.role || 'employee'}
                                    onChange={(e) => onRoleChange(member, orgId, e.target.value)}
                                    disabled={changingRole === member.id}
                                    className={`text-xs border border-surface-200 dark:border-surface-600 rounded-lg px-2 py-1 bg-white dark:bg-surface-800 text-surface-600 dark:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 cursor-pointer transition-colors ${changingRole === member.id ? 'opacity-50' : ''}`}
                                >
                                    <option value="admin">기관관리자</option>
                                    <option value="employee">직원</option>
                                </select>
                            </td>
                            <td className="py-2.5 px-3 text-center">
                                <button
                                    onClick={() => onRemoveMember(member, orgId)}
                                    className="btn-icon btn-sm text-surface-400 dark:text-surface-500 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                                    title="직원 제거"
                                    aria-label={`${member.name || '직원'} 제거`}
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
    );
});
