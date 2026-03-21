/**
 * OrgCard — 활성 기관 카드 (아코디언 형태)
 * 접힌 상태: 기관명 + 직원 수 + 초대코드 요약만 표시
 * 펼친 상태: 상세 정보 + 멤버 목록 + 편집/복원 기능
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
    memberCount: number;
    isExpanded: boolean;
    changingRole: string | null;
    loadingMembers: boolean;
    onToggle: (orgId: string) => void;
    onDelete: (org: Organization) => void;
    onEditOrg: (orgId: string, updates: { name: string; address: string }) => Promise<void>;
    onRoleChange: (member: OrgMember, orgId: string, newRole: string) => void;
    onRemoveMember: (member: OrgMember, orgId: string) => void;
    onRestoreUser: (email: string, orgId: string, name: string) => Promise<void>;
}


export default function OrgCard({
    org, members, memberCount, isExpanded, changingRole, loadingMembers,
    onToggle, onDelete, onEditOrg, onRoleChange, onRemoveMember, onRestoreUser,
}: OrgCardProps) {
    // 익명 계정 필터링 (이름이 없거나 '-'인 계정 제외)
    const visibleMembers = members.filter(m => m.name && m.name !== '-');

    // 경과일 계산 (직원 0명일 때만)
    const daysSinceApproval = (() => {
        if (memberCount > 0 || !org.approvedAt) return null;
        const approved = 'toDate' in org.approvedAt
            ? (org.approvedAt as any).toDate()
            : new Date(org.approvedAt as any);
        return Math.floor((Date.now() - approved.getTime()) / (1000 * 60 * 60 * 24));
    })();

    const appliedDate = (() => {
        if (!org.createdAt) return null;
        const d = 'toDate' in org.createdAt
            ? (org.createdAt as any).toDate()
            : new Date(org.createdAt as any);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mi = String(d.getMinutes()).padStart(2, '0');
        return `${d.getFullYear()}.${mm}.${dd} ${hh}:${mi}`;
    })();

    const getDaysBadgeStyle = (days: number) => {
        if (days >= 14) return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
        if (days >= 7) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
        return 'bg-surface-100 text-surface-500 dark:bg-surface-700 dark:text-surface-400';
    };

    // 인라인 편집 상태
    const [editing, setEditing] = useState(false);
    const [editForm, setEditForm] = useState({ name: '', address: '' });
    const [saving, setSaving] = useState(false);

    // 증빙서류 이미지 토글
    const [showImage, setShowImage] = useState(false);

    // 계정 복원 상태
    const [showRestore, setShowRestore] = useState(false);
    const [restoreForm, setRestoreForm] = useState({ email: '', name: '' });
    const [restoring, setRestoring] = useState(false);

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
            {/* ===== 접힌 상태 헤더 (항상 표시) ===== */}
            <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer select-none"
                onClick={() => !editing && onToggle(org.id)}
            >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                    {/* 펼침/접힘 화살표 */}
                    <svg
                        className={`w-4 h-4 text-surface-400 shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                        fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                    </svg>

                    {/* 기관명 */}
                    <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate">
                        {org.name}
                    </h3>

                    {/* 요약 뱃지들 */}
                    <div className="flex items-center gap-2 shrink-0">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
                            </svg>
                            {memberCount}명
                        </span>

                        {appliedDate && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400">
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
                                </svg>
                                {appliedDate}
                            </span>
                        )}

                        {daysSinceApproval !== null && (
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-bold ${getDaysBadgeStyle(daysSinceApproval)}`}>
                                D+{daysSinceApproval}
                            </span>
                        )}

                        <code className="hidden sm:inline-block bg-surface-100 dark:bg-surface-700 px-1.5 py-0.5 rounded text-primary-700 dark:text-primary-300 font-mono text-xs">
                            {org.inviteCode}
                        </code>
                    </div>
                </div>

                {/* 삭제 버튼 */}
                <button
                    onClick={(e) => { e.stopPropagation(); onDelete(org); }}
                    className="btn-ghost btn-sm text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 shrink-0 ml-2"
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                    </svg>
                </button>
            </div>

            {/* ===== 펼친 상태 상세 내용 ===== */}
            {isExpanded && (
                <div className="animate-slide-down">
                    {/* 상세 정보 */}
                    <div className="px-5 pb-4 border-t border-surface-100 dark:border-surface-700 pt-3">
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
                            /* 상세 정보 표시 */
                            <div className="space-y-2">
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
                                </div>

                                <div className="flex flex-wrap gap-3 text-sm text-surface-500 dark:text-surface-400">
                                    <span
                                        className="cursor-pointer hover:text-primary-500 transition-colors"
                                        title="클릭하여 기관 ID 복사"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            navigator.clipboard.writeText(org.id);
                                        }}
                                    >
                                        ID: <code className="bg-surface-100 dark:bg-surface-700 px-1 py-0.5 rounded text-xs font-mono">{org.id.slice(0, 8)}…</code>
                                    </span>
                                    <span>•</span>
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
                                    <p className="text-sm text-surface-400 flex items-center gap-1.5">
                                        {org.address}
                                        <a
                                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(org.address)}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onClick={e => e.stopPropagation()}
                                            className="inline-flex items-center gap-0.5 ml-1 px-1.5 py-0.5 rounded text-xs font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                                            title="구글 지도에서 보기"
                                        >
                                            📍 지도
                                        </a>
                                    </p>
                                )}

                                {/* 증빙서류 보기 토글 */}
                                {org.uniqueNumberImageUrl && (
                                    <div className="mt-1">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setShowImage(v => !v); }}
                                            className="text-xs text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium transition-colors"
                                        >
                                            {showImage ? '증빙서류 닫기 ▲' : '📋 증빙서류 보기 ▼'}
                                        </button>
                                        {showImage && (() => {
                                            const url = org.uniqueNumberImageUrl || '';
                                            const isPdf = /\.pdf($|\?)/i.test(url) || (url.includes('%2F') && url.toLowerCase().includes('.pdf'));
                                            if (isPdf) {
                                                return (
                                                    <a
                                                        href={url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="mt-2 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-700 hover:bg-primary-100 dark:hover:bg-primary-900/30 transition-colors text-sm font-medium animate-slide-down"
                                                    >
                                                        📄 PDF 증빙서류 보기 (새 창)
                                                    </a>
                                                );
                                            }
                                            return (
                                                <img
                                                    src={url}
                                                    alt="증빙서류"
                                                    className="mt-2 max-w-md rounded-lg border border-surface-200 dark:border-surface-600 animate-slide-down"
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            );
                                        })()}
                                    </div>
                                )}

                                {/* 신청자 정보 */}
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
                            </div>
                        )}
                    </div>

                    {/* 멤버 목록 */}
                    <div className="border-t border-surface-100 dark:border-surface-700 bg-surface-50/50 dark:bg-surface-800/50">
                        {loadingMembers ? (
                            <div className="p-6 flex items-center justify-center gap-2 text-sm text-surface-400">
                                <div className="w-4 h-4 spinner" />
                                멤버 정보 불러오는 중...
                            </div>
                        ) : visibleMembers.length === 0 ? (
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

                        {/* 계정 복원 섹션 */}
                        <div className="border-t border-surface-200 dark:border-surface-600 p-4">
                            {!showRestore ? (
                                <button
                                    onClick={() => setShowRestore(true)}
                                    className="flex items-center gap-2 text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182M2.985 19.644l3.181-3.18" />
                                    </svg>
                                    삭제된 계정 복원
                                </button>
                            ) : (
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <h4 className="text-sm font-medium text-surface-700 dark:text-surface-300 flex items-center gap-1.5">
                                            <svg className="w-4 h-4 text-primary-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182M2.985 19.644l3.181-3.18" />
                                            </svg>
                                            계정 복원
                                        </h4>
                                        <button
                                            onClick={() => { setShowRestore(false); setRestoreForm({ email: '', name: '' }); }}
                                            className="text-xs text-surface-400 hover:text-surface-600 transition-colors"
                                        >
                                            닫기
                                        </button>
                                    </div>
                                    <p className="text-xs text-surface-400 dark:text-surface-500">
                                        삭제(비활성화)된 직원의 이메일을 입력하면 계정을 복원합니다.
                                    </p>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={restoreForm.name}
                                            onChange={e => setRestoreForm(prev => ({ ...prev, name: e.target.value }))}
                                            className="input text-sm flex-[1]"
                                            placeholder="이름"
                                        />
                                        <input
                                            type="email"
                                            value={restoreForm.email}
                                            onChange={e => setRestoreForm(prev => ({ ...prev, email: e.target.value }))}
                                            className="input text-sm flex-[2]"
                                            placeholder="이메일"
                                        />
                                        <button
                                            onClick={async () => {
                                                if (!restoreForm.email.trim()) return;
                                                setRestoring(true);
                                                try {
                                                    await onRestoreUser(restoreForm.email.trim(), org.id, restoreForm.name.trim());
                                                    setRestoreForm({ email: '', name: '' });
                                                    setShowRestore(false);
                                                } finally {
                                                    setRestoring(false);
                                                }
                                            }}
                                            disabled={restoring || !restoreForm.email.trim()}
                                            className="btn-primary btn-sm text-xs whitespace-nowrap"
                                        >
                                            {restoring ? <><div className="w-3 h-3 spinner" />복원 중...</> : '복원'}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
