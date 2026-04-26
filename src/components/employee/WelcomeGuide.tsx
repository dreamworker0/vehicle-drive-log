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
                className="absolute top-3 right-3 p-1 rounded-lg text-surface-400 hover:text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
                title="닫기"
            >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
            </button>
            <h3 className="text-base font-bold text-surface-900 dark:text-surface-100 mb-3">👋 환영합니다!</h3>
            <div className="space-y-2.5 text-sm text-surface-600 dark:text-surface-400">
                <div className="flex items-start gap-3">
                    <span className="w-7 h-7 rounded-lg bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-sm flex-shrink-0">📅</span>
                    <div>
                        <p className="font-medium text-surface-800 dark:text-surface-200">예약</p>
                        <p className="text-xs text-surface-400">먼저 달력에서 원하시는 차량과 날짜를 콕 찍어주세요!</p>
                    </div>
                </div>
                <div className="flex items-start gap-3">
                    <span className="w-7 h-7 rounded-lg bg-accent-100 dark:bg-accent-900/30 flex items-center justify-center text-sm flex-shrink-0">🚗</span>
                    <div>
                        <p className="font-medium text-surface-800 dark:text-surface-200">운행 시작</p>
                        <p className="text-xs text-surface-400">예약해 둔 카드에서 '운행 시작' 버튼을 누르면 출발 준비 끝이에요.</p>
                    </div>
                </div>
                <div className="flex items-start gap-3">
                    <span className="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-sm flex-shrink-0">📸</span>
                    <div>
                        <p className="font-medium text-surface-800 dark:text-surface-200">일지 작성</p>
                        <p className="text-xs text-surface-400">운행을 마치고 계기판 사진을 찰칵 찍으면 귀찮은 주행거리가 알아서 쏙 입력된답니다.</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
