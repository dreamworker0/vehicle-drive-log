/**
 * ReleaseNotesBanner — 첫화면 상단 '새 업데이트 소식' 알림 배너
 *
 * 아직 확인하지 않은 새 소식이 있을 때만 노출된다.
 * '보기'를 누르면 인앱 모달을 열고 확인 처리(markSeen)하며, ✕로 닫아도 확인 처리된다.
 */
import { useState } from 'react';
import useReleaseNotesStatus from '../../hooks/useReleaseNotesStatus';
import ReleaseNotesModal from './ReleaseNotesModal';

export default function ReleaseNotesBanner() {
    const { hasNew, markSeen } = useReleaseNotesStatus();
    const [open, setOpen] = useState(false);

    return (
        <>
            {hasNew && (
                <div className="glass-card p-3 mb-4 flex items-center gap-3 border border-primary-200 dark:border-primary-800 bg-primary-50/60 dark:bg-primary-900/20">
                    <span className="flex-shrink-0 text-xl" aria-hidden="true">📢</span>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-surface-800 dark:text-surface-100">새로운 업데이트 소식이 있어요</p>
                        <p className="text-xs text-surface-500 dark:text-surface-400">추가·개선된 기능을 확인해 보세요.</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => { markSeen(); setOpen(true); }}
                        className="flex-shrink-0 btn-primary btn-sm min-h-[44px]"
                    >
                        보기
                    </button>
                    <button
                        type="button"
                        onClick={() => markSeen()}
                        aria-label="닫기"
                        className="flex-shrink-0 btn-icon min-h-[44px] min-w-[44px] text-surface-400 dark:text-surface-500 hover:text-surface-600 dark:hover:text-surface-300"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            )}
            {open && <ReleaseNotesModal onClose={() => setOpen(false)} />}
        </>
    );
}
