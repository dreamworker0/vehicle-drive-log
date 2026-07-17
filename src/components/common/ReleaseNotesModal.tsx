/**
 * ReleaseNotesModal — 로그인한 사용자용 '업데이트 소식' 인앱 모달
 *
 * 공개용 ReleaseNotesPage(/release-notes)는 라이트모드 강제·공개 네비를 쓰므로,
 * 로그인 상태에서는 다크모드를 유지하는 이 모달로 소식을 보여준다.
 */
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { loadReleaseNotes, type ReleaseItem, type ReleaseNote } from '../../lib/releaseNotes';

const TYPE_CONFIG: Record<ReleaseItem['type'], { emoji: string; label: string; color: string }> = {
    new: { emoji: '✨', label: '신규', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
    improved: { emoji: '💡', label: '개선', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
    fixed: { emoji: '🐛', label: '수정', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
};

/** 최근 N일 이내 소식만 노출(기본 7일). 너무 많은 과거 소식으로 압도되지 않게 한다. */
const RECENT_DAYS = 7;

function cutoffDateStr(days: number): string {
    const now = new Date();
    const c = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
    return `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`;
}

export default function ReleaseNotesModal({ onClose }: { onClose: () => void }) {
    const [notes, setNotes] = useState<ReleaseNote[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAll, setShowAll] = useState(false);

    useEffect(() => {
        loadReleaseNotes().then((data) => {
            setNotes(data);
            setLoading(false);
        });
    }, []);

    // 최근 7일 이내 소식. 없으면 가장 최근 1건은 보여준다(빈 화면 방지).
    const cutoff = cutoffDateStr(RECENT_DAYS);
    const recent = notes.filter((n) => n.date >= cutoff);
    const sorted = [...notes].sort((a, b) => (a.date < b.date ? 1 : -1));
    const recentOrLatest = recent.length > 0 ? recent : sorted.slice(0, 1);
    const visibleNotes = showAll ? notes : recentOrLatest;
    const hiddenCount = notes.length - visibleNotes.length;

    return createPortal(
        <div
            role="presentation"
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4"
            onClick={onClose}
            onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
        >
            <div
                role="presentation"
                className="bg-white dark:bg-surface-800 rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6 animate-scale-in"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-surface-900 dark:text-surface-100">📋 업데이트 소식</h3>
                    <button
                        onClick={onClose}
                        className="btn-icon min-h-[48px] min-w-[48px] text-surface-400 dark:text-surface-500 hover:text-surface-600 dark:hover:text-surface-300"
                        aria-label="닫기"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {loading ? (
                    <div className="flex justify-center py-12"><div className="w-8 h-8 spinner" /></div>
                ) : (
                    <div className="space-y-6">
                        {!showAll && recent.length > 0 && (
                            <p className="text-xs text-surface-400 dark:text-surface-500">최근 {RECENT_DAYS}일 이내 소식이에요.</p>
                        )}
                        {visibleNotes.map((note, noteIdx) => (
                            <section key={note.date + noteIdx} className="space-y-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <time className="text-sm font-mono font-semibold text-primary-600 dark:text-primary-400 whitespace-nowrap">
                                        {note.date}
                                    </time>
                                    {note.title && (
                                        <span className="text-sm font-medium text-surface-700 dark:text-surface-300">
                                            {note.title}
                                        </span>
                                    )}
                                </div>
                                <ul className="space-y-2 pl-1">
                                    {note.items.map((item, idx) => {
                                        const cfg = TYPE_CONFIG[item.type];
                                        return (
                                            <li key={idx} className="flex items-start gap-2.5 text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                                                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap mt-0.5 ${cfg.color}`}>
                                                    {cfg.emoji} {cfg.label}
                                                </span>
                                                <span>{item.text}</span>
                                            </li>
                                        );
                                    })}
                                </ul>
                                {noteIdx < visibleNotes.length - 1 && (
                                    <hr className="border-surface-100 dark:border-surface-700 mt-4" />
                                )}
                            </section>
                        ))}

                        {!showAll && hiddenCount > 0 && (
                            <button
                                type="button"
                                onClick={() => setShowAll(true)}
                                className="w-full text-center text-sm text-primary-600 dark:text-primary-400 font-medium py-2 hover:underline"
                            >
                                이전 업데이트 소식 모두 보기 ({hiddenCount}개) ▾
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
}
