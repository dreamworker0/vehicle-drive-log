/**
 * DeletedOrgCard — 삭제된 기관 카드 (OrgManagement에서 분리)
 */
import type { Organization } from '../../types';

interface DeletedOrgCardProps {
    org: Organization;
    isDeleting: boolean;
    onRestore: (org: Organization) => void;
    onPermanentDelete: (org: Organization) => void;
}

function getDaysInfo(deletedAt: Organization['deletedAt']): { elapsed: number; remaining: number } {
    if (!deletedAt) return { elapsed: 0, remaining: 30 };
    const deletedDate = (typeof (deletedAt as unknown as { toDate?: () => Date }).toDate === 'function')
        ? (deletedAt as { toDate: () => Date }).toDate()
        : new Date(deletedAt as string | Date);
    const elapsed = Math.floor((Date.now() - deletedDate.getTime()) / (1000 * 60 * 60 * 24));
    return { elapsed, remaining: Math.max(0, 30 - elapsed) };
}

export default function DeletedOrgCard({ org, isDeleting, onRestore, onPermanentDelete }: DeletedOrgCardProps) {
    const { elapsed, remaining } = getDaysInfo(org.deletedAt);

    return (
        <div className={`glass-card overflow-hidden border-l-4 border-l-red-300 dark:border-l-red-700 transition-opacity ${isDeleting ? 'opacity-60' : ''}`}>
            <div className="p-5">
                <div className="flex items-start justify-between">
                    <div className="space-y-2 flex-1">
                        <div className="flex items-center gap-2">
                            <h3 className="text-lg font-semibold text-surface-600 dark:text-surface-400">{org.name}</h3>
                            {isDeleting ? (
                                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 flex items-center gap-1">
                                    <span className="w-3 h-3 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                                    삭제 중…
                                </span>
                            ) : (
                                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">삭제됨</span>
                            )}
                        </div>
                        <div className="flex flex-wrap gap-3 text-sm text-surface-400 dark:text-surface-500">
                            <span>고유번호: {org.uniqueNumber}</span>
                            <span>•</span>
                            <span>삭제 {elapsed}일 경과</span>
                            <span>•</span>
                            <span className={remaining <= 7 ? 'text-red-500 font-medium' : ''}>
                                복구 가능: D-{remaining}
                            </span>
                        </div>
                        {org.address && (
                            <p className="text-sm text-surface-400 dark:text-surface-500">{org.address}</p>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => onRestore(org)}
                            disabled={isDeleting}
                            className="btn-ghost btn-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/20 disabled:opacity-40 disabled:cursor-not-allowed"
                            title="복구"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
                            </svg>
                        </button>
                        <button
                            onClick={() => onPermanentDelete(org)}
                            disabled={isDeleting}
                            className="btn-ghost btn-sm text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40 disabled:cursor-not-allowed"
                            title="영구 삭제"
                        >
                            {isDeleting ? (
                                <span className="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin inline-block" />
                            ) : (
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                </svg>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
