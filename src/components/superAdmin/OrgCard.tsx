/**
 * OrgCard — 활성 기관 카드 (아코디언 형태)
 * 접힌 상태: 기관명 + 직원 수 + 초대코드 요약만 표시
 * 펼친 상태: 상세 정보 + 멤버 목록 + 편집/복원 기능
 */
import { memo, useState } from 'react';
import { formatTimestampFull } from '../../lib/dateUtils';
import DocumentViewer from '../common/DocumentViewer';
import OrgCardHeader from './orgCard/OrgCardHeader';
import OrgEditForm from './orgCard/OrgEditForm';
import OrgMemberTable from './orgCard/OrgMemberTable';
import OrgRestoreForm from './orgCard/OrgRestoreForm';
import type { Organization } from '../../types';

interface OrgMember {
    id: string;
    name?: string;
    email?: string;
    role?: string;
    [key: string]: unknown;
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


export default memo(function OrgCard({
    org, members, memberCount, isExpanded, changingRole, loadingMembers,
    onToggle, onDelete, onEditOrg, onRoleChange, onRemoveMember, onRestoreUser,
}: OrgCardProps) {
    const [editing, setEditing] = useState(false);
    const [showImage, setShowImage] = useState(false);

    // 익명 계정 필터링 (이름이 없거나 '-'인 계정 제외)
    const visibleMembers = members.filter(m => m.name && m.name !== '-');

    return (
        <div className="glass-card overflow-hidden transition-shadow hover:shadow-glass-lg">
            {/* ===== 접힌 상태 헤더 ===== */}
            <OrgCardHeader
                org={org}
                memberCount={memberCount}
                isExpanded={isExpanded}
                editing={editing}
                onToggle={onToggle}
                onDelete={onDelete}
            />

            {/* ===== 펼친 상태 상세 내용 ===== */}
            {isExpanded && (
                <div className="animate-slide-down">
                    {/* 상세 정보 */}
                    <div className="px-5 pb-4 border-t border-surface-100 dark:border-surface-700 pt-3">
                        {editing ? (
                            <OrgEditForm
                                orgId={org.id}
                                initialName={org.name || ''}
                                initialAddress={org.address || ''}
                                onSave={async (id, updates) => {
                                    await onEditOrg(id, updates);
                                    setEditing(false);
                                }}
                                onCancel={() => setEditing(false)}
                            />
                        ) : (
                            /* 상세 정보 표시 */
                            <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                    <h3 className="text-lg font-semibold text-surface-900 dark:text-surface-100">{org.name}</h3>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setEditing(true);
                                        }}
                                        className="p-1 rounded-lg text-surface-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors"
                                        title="기관명·주소 편집"
                                        aria-label="기관명·주소 편집"
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
                                        {showImage && (
                                            <DocumentViewer url={org.uniqueNumberImageUrl || ''} stopPropagation />
                                        )}
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

                                {/* 하고 싶은 말 */}
                                {org.message && (
                                    <div className="mt-2 px-3 py-2 rounded-lg bg-primary-50 dark:bg-primary-900/20 border border-primary-100 dark:border-primary-800 text-sm">
                                        <span className="text-xs font-medium text-primary-500 dark:text-primary-400">💬 하고 싶은 말</span>
                                        <p className="text-surface-700 dark:text-surface-300 mt-0.5 whitespace-pre-wrap">{org.message}</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* 멤버 목록 */}
                    <div className="border-t border-surface-100 dark:border-surface-700 bg-surface-50/50 dark:bg-surface-800/50">
                        <OrgMemberTable
                            members={members}
                            orgId={org.id}
                            changingRole={changingRole}
                            loadingMembers={loadingMembers}
                            onRoleChange={onRoleChange}
                            onRemoveMember={onRemoveMember}
                        />

                        {/* 계정 복원 섹션 */}
                        <div className="border-t border-surface-200 dark:border-surface-600 p-4">
                            <OrgRestoreForm orgId={org.id} onRestoreUser={onRestoreUser} />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});
