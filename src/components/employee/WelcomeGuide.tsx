/**
 * WelcomeGuide — 첫 방문 시 1회 표시되는 웰컴 가이드 카드
 */

interface WelcomeGuideProps {
    onDismiss: () => void;
}

export default function WelcomeGuide({ onDismiss }: WelcomeGuideProps) {
    return (
        <div className="glass-card border-2 border-primary-200 p-5 mb-5 animate-fade-in relative">
            <button
                onClick={onDismiss}
                className="absolute top-3 right-3 p-1 rounded-lg text-surface-400 hover:text-surface-600 dark:text-surface-400 hover:bg-surface-100 transition-colors"
                title="닫기"
            >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
            </button>
            <h3 className="text-base font-bold text-surface-900 dark:text-surface-100 mb-3">👋 환영합니다!</h3>
            <div className="space-y-2.5 text-sm text-surface-600 dark:text-surface-400">
                <div className="flex items-start gap-3">
                    <span className="w-7 h-7 rounded-lg bg-primary-100 flex items-center justify-center text-sm flex-shrink-0">📅</span>
                    <div>
                        <p className="font-medium text-surface-800 dark:text-surface-200">예약하기</p>
                        <p className="text-xs text-surface-400">달력에서 차량과 시간을 선택하세요</p>
                    </div>
                </div>
                <div className="flex items-start gap-3">
                    <span className="w-7 h-7 rounded-lg bg-accent-100 flex items-center justify-center text-sm flex-shrink-0">🚗</span>
                    <div>
                        <p className="font-medium text-surface-800 dark:text-surface-200">운행 시작</p>
                        <p className="text-xs text-surface-400">예약 카드에서 '운행 시작'을 눌러주세요</p>
                    </div>
                </div>
                <div className="flex items-start gap-3">
                    <span className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center text-sm flex-shrink-0">📸</span>
                    <div>
                        <p className="font-medium text-surface-800 dark:text-surface-200">일지 작성</p>
                        <p className="text-xs text-surface-400">도착 후 계기판을 촬영하면 주행거리가 자동 입력됩니다</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
