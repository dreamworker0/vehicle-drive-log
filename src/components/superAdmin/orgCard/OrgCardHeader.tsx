/**
 * OrgCardHeader — 기관 카드 접힌 상태 헤더
 * 기관명, 뱃지(직원 수, 등록일, 경과일, 초대코드), 삭제 버튼
 */
import { memo, useMemo, useState } from 'react';
import { formatTimestampFull } from '../../../lib/dateUtils';
import type { Organization } from '../../../types';

interface Props {
    org: Organization;
    memberCount: number;
    isExpanded: boolean;
    editing: boolean;
    onToggle: (orgId: string) => void;
    onDelete: (org: Organization) => void;
}

function getDaysBadgeStyle(days: number) {
    if (days >= 14) return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
    if (days >= 7) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    return 'bg-surface-100 text-surface-500 dark:bg-surface-700 dark:text-surface-400';
}

export default memo(function OrgCardHeader({ org, memberCount, isExpanded, editing, onToggle, onDelete }: Props) {
    const [now] = useState(() => Date.now());
    const daysSinceApproval = useMemo(() => {
        if (memberCount > 0 || !org.approvedAt) return null;
        const approved = 'toDate' in org.approvedAt
            ? (org.approvedAt as { toDate: () => Date }).toDate()
            : new Date(org.approvedAt as unknown as string);
        return Math.floor((now - approved.getTime()) / (1000 * 60 * 60 * 24));
    }, [memberCount, org.approvedAt, now]);

    const appliedDate = formatTimestampFull(org.createdAt);

    return (
        <div
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!editing) onToggle(org.id); } }}
            className="flex items-center justify-between px-4 py-3 cursor-pointer select-none"
            onClick={() => !editing && onToggle(org.id)}
        >
            <div className="flex items-center gap-3 flex-1 min-w-0">
                {/* 펼침/접힘 화살표 */}
                <svg
                    className={`w-4 h-4 text-surface-400 dark:text-surface-500 shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
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
                className="btn-ghost btn-sm text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 shrink-0 ml-2"
                aria-label="기관 삭제"
            >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                </svg>
            </button>
        </div>
    );
});
