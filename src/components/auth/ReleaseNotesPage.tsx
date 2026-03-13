import { useNavigate } from 'react-router-dom';
import { RELEASE_NOTES, type ReleaseItem } from '../../lib/releaseNotes';
import useForceLightMode from '../../hooks/useForceLightMode';

const TYPE_CONFIG: Record<ReleaseItem['type'], { emoji: string; label: string; color: string }> = {
    new: { emoji: '✨', label: '신규', color: 'bg-emerald-100 text-emerald-700' },
    improved: { emoji: '💡', label: '개선', color: 'bg-blue-100 text-blue-700' },
    fixed: { emoji: '🐛', label: '수정', color: 'bg-amber-100 text-amber-700' },
};

export default function ReleaseNotesPage() {
    useForceLightMode();
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-gradient-to-br from-surface-50 to-primary-50 py-8 px-4">
            <div className="w-full max-w-2xl mx-auto animate-fade-in">
                {/* 뒤로가기 */}
                <button
                    onClick={() => navigate(-1)}
                    className="flex items-center gap-1.5 text-sm text-surface-500 hover:text-surface-700 mb-6 transition-colors"
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                    </svg>
                    돌아가기
                </button>

                <div className="bg-white rounded-2xl shadow-soft p-6 md:p-8 space-y-8">
                    <div className="text-center border-b border-surface-100 pb-6">
                        <h1 className="text-2xl font-bold text-surface-900 mb-1">📋 업데이트 소식</h1>
                        <p className="text-sm text-surface-400">
                            차량 운행일지 서비스의 변경 사항을 확인하세요.
                        </p>
                    </div>

                    {RELEASE_NOTES.map((note) => (
                        <section key={note.date} className="space-y-3">
                            {/* 날짜 헤더 */}
                            <div className="flex items-center gap-3">
                                <time className="text-sm font-mono font-semibold text-primary-600 whitespace-nowrap">
                                    {note.date}
                                </time>
                                {note.title && (
                                    <span className="text-sm font-medium text-surface-700 truncate">
                                        {note.title}
                                    </span>
                                )}
                            </div>

                            {/* 변경 사항 리스트 */}
                            <ul className="space-y-2 pl-1">
                                {note.items.map((item, idx) => {
                                    const cfg = TYPE_CONFIG[item.type];
                                    return (
                                        <li key={idx} className="flex items-start gap-2.5 text-sm text-surface-600 leading-relaxed">
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
                            {note !== RELEASE_NOTES[RELEASE_NOTES.length - 1] && (
                                <hr className="border-surface-100" />
                            )}
                        </section>
                    ))}

                    <div className="border-t border-surface-100 pt-4 text-center">
                        <p className="text-xs text-surface-400">
                            © 2026 차량 운행일지. 지속적으로 개선하고 있습니다.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
