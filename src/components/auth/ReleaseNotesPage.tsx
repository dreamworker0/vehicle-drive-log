import { useState, useEffect } from 'react';
import { loadReleaseNotes, type ReleaseItem, type ReleaseNote } from '../../lib/releaseNotes';
import useForceLightMode from '../../hooks/useForceLightMode';
import SEOHead from '../common/SEOHead';
import PublicNav from '../common/PublicNav';

const TYPE_CONFIG: Record<ReleaseItem['type'], { emoji: string; label: string; color: string }> = {
    new: { emoji: '✨', label: '신규', color: 'bg-emerald-100 text-emerald-700' },
    improved: { emoji: '💡', label: '개선', color: 'bg-blue-100 text-blue-700' },
    fixed: { emoji: '🐛', label: '수정', color: 'bg-amber-100 text-amber-700' },
};

export default function ReleaseNotesPage() {
    useForceLightMode();
    const [notes, setNotes] = useState<ReleaseNote[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadReleaseNotes().then((data) => {
            setNotes(data);
            setLoading(false);
        });
    }, []);

    return (
        <div className="min-h-screen bg-gradient-to-br from-surface-50 to-primary-50 flex flex-col">
            <SEOHead
                title="업데이트 소식"
                description="차량 운행일지의 신규 기능, 개선 사항, 버그 수정 내역을 확인하세요."
                path="/release-notes"
            />
            <PublicNav />
            <div className="flex-1 py-8 px-4">
            <div className="w-full max-w-2xl mx-auto animate-fade-in">
                <div className="bg-white dark:bg-surface-900 rounded-2xl shadow-soft p-6 md:p-8 space-y-8">
                    <div className="text-center border-b border-surface-100 dark:border-surface-700 pb-6">
                        <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-1">📋 업데이트 소식</h1>
                        <p className="text-sm text-surface-400 dark:text-surface-500">
                            차량 운행일지 서비스의 변경 사항을 확인하세요.
                        </p>
                    </div>

                    {loading ? (
                        <div className="flex justify-center py-12">
                            <div className="w-8 h-8 border-4 border-primary-200 dark:border-primary-800/50 border-t-primary-600 rounded-full animate-spin" />
                        </div>
                    ) : (
                        notes.map((note, noteIdx) => (
                            <section key={note.date + noteIdx} className="space-y-3">
                                {/* 날짜 헤더 */}
                                <div className="flex items-center gap-3">
                                    <time className="text-sm font-mono font-semibold text-primary-600 dark:text-primary-400 whitespace-nowrap">
                                        {note.date}
                                    </time>
                                    {note.title && (
                                        <span className="text-sm font-medium text-surface-700 dark:text-surface-300 truncate">
                                            {note.title}
                                        </span>
                                    )}
                                </div>

                                {/* 변경 사항 리스트 */}
                                <ul className="space-y-2 pl-1">
                                    {note.items.map((item, idx) => {
                                        const cfg = TYPE_CONFIG[item.type];
                                        return (
                                            <li key={idx} className="flex items-start gap-2.5 text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                                                <span
                                                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap mt-0.5 ${cfg.color}`}
                                                >
                                                    {cfg.emoji} {cfg.label}
                                                </span>
                                                <span>{item.text}</span>
                                            </li>
                                        );
                                    })}
                                </ul>

                                {/* 구분선 (마지막 제외) */}
                                {noteIdx < notes.length - 1 && (
                                    <hr className="border-surface-100 dark:border-surface-700" />
                                )}
                            </section>
                        ))
                    )}

                    <div className="border-t border-surface-100 dark:border-surface-700 pt-4 text-center">
                        <p className="text-xs text-surface-400 dark:text-surface-500">
                            © 2026 차량 운행일지. 지속적으로 개선하고 있습니다.
                        </p>
                    </div>
                </div>
            </div>
            </div>
        </div>
    );
}
