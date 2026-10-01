import { useState, useEffect } from 'react';
import { loadReleaseNotes, type ReleaseNote } from '../../lib/releaseNotes';
import ReleaseNoteItems from '../common/ReleaseNoteItems';
import useForceLightMode from '../../hooks/useForceLightMode';
import SEOHead from '../common/SEOHead';
import PublicNav from '../common/PublicNav';

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
                                <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
                                    <time className="text-sm font-mono font-semibold text-primary-600 dark:text-primary-400 whitespace-nowrap">
                                        {note.date}
                                    </time>
                                    {note.title && (
                                        <span className="text-sm font-medium text-surface-700 dark:text-surface-300">
                                            {note.title}
                                        </span>
                                    )}
                                </div>

                                {/* 변경 사항 리스트 — 주제별로 묶는다 */}
                                <ReleaseNoteItems items={note.items} />

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
