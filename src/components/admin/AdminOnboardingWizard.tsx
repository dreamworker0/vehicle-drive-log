/**
 * AdminOnboardingWizard — 기관 관리자 온보딩 위자드
 * 차량·직원이 없는 첫 접속 시 단계별 설정을 안내합니다.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface Props {
    inviteCode: string;
    onDismiss: () => void;
}

interface OnboardingStep {
    icon: string;
    title: string;
    desc: string;
    action: string | null;
    path: string | null;
}

const LS_KEY = 'admin-onboarding-dismissed';

const STEPS = [
    {
        icon: '🚗',
        title: '차량을 등록하세요',
        desc: '운행일지를 작성하려면 먼저 차량이 필요합니다.\n차량번호, 모델명, 연료 유형을 입력하면 끝!',
        action: '차량 등록하러 가기',
        path: '/admin/vehicles',
    },
    {
        icon: '👥',
        title: '직원을 등록하세요',
        desc: '직원 이름과 이메일을 미리 등록해놓으면,\n초대 링크로 가입할 때 자동으로 매칭됩니다.',
        action: '직원 관리 열기',
        path: '/admin/employees',
    },
    {
        icon: '🔗',
        title: '초대 링크를 공유하세요',
        desc: '아래 링크를 직원들에게 보내주세요.\n링크를 클릭하면 기관에 자동으로 연결됩니다.',
        action: null,
        path: null,
    },
    {
        icon: '✅',
        title: '준비 완료!',
        desc: '직원들이 초대 링크를 통해 가입하면\n바로 차량 예약과 운행일지 작성이 가능합니다.',
        action: null,
        path: null,
    },
];

export default function AdminOnboardingWizard({ inviteCode, onDismiss }: Props) {
    const [step, setStep] = useState(0);
    const navigate = useNavigate();
    const current = STEPS[step];
    const isLast = step === STEPS.length - 1;

    const handleDismiss = () => {
        try { localStorage.setItem(LS_KEY, 'true'); } catch { /* noop */ }
        onDismiss();
    };

    const handleAction = () => {
        if (current.path) {
            navigate(current.path);
            handleDismiss();
        }
    };

    return (
        <div className="glass-card border-2 border-primary-200 p-6 mb-6 animate-fade-in">
            {/* 헤더 */}
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
                    <span className="w-8 h-8 rounded-lg bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-base">🏁</span>
                    시작 가이드
                </h2>
                <button
                    onClick={handleDismiss}
                    className="text-xs text-surface-400 hover:text-surface-600 dark:text-surface-400 transition-colors"
                >
                    건너뛰기
                </button>
            </div>

            {/* 프로그레스 */}
            <div className="flex gap-1.5 mb-6">
                {STEPS.map((_, i) => (
                    <div
                        key={i}
                        className={`h-1 flex-1 rounded-full transition-colors duration-300 ${i <= step ? 'bg-primary-500' : 'bg-surface-200 dark:bg-surface-700'
                            }`}
                    />
                ))}
            </div>

            {/* 본문 */}
            <div className="text-center py-4">
                <div className="text-4xl mb-4">{current.icon}</div>
                <h3 className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-2">{current.title}</h3>
                <p className="text-sm text-surface-500 dark:text-surface-400 whitespace-pre-line leading-relaxed max-w-sm mx-auto">
                    {current.desc}
                </p>

                {/* 초대 링크 표시 (Step 3) */}
                {step === 2 && inviteCode && (
                    <div className="mt-4 flex flex-col items-center gap-2">
                        <div className="inline-flex items-center gap-2 bg-primary-50 dark:bg-primary-900/30 px-4 py-2.5 rounded-xl max-w-full">
                            <svg className="w-4 h-4 text-primary-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m9.862-2.22a4.5 4.5 0 0 0-1.242-7.244l-4.5-4.5a4.5 4.5 0 0 0-6.364 6.364L4.25 8.81" />
                            </svg>
                            <span className="text-sm font-medium text-primary-700 dark:text-primary-300 truncate">
                                {`https://vehicle-drive-log.web.app?code=${inviteCode}`}
                            </span>
                        </div>
                        <button
                            onClick={() => {
                                const link = `https://vehicle-drive-log.web.app?code=${inviteCode}`;
                                navigator.clipboard?.writeText(link);
                            }}
                            className="btn-secondary btn-sm inline-flex items-center gap-1.5"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
                            </svg>
                            링크 복사하기
                        </button>
                    </div>
                )}
            </div>

            {/* 버튼 */}
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-surface-100 dark:border-surface-700">
                <button
                    onClick={() => setStep(s => Math.max(0, s - 1))}
                    disabled={step === 0}
                    className="btn-ghost btn-sm disabled:opacity-0"
                >
                    ← 이전
                </button>

                <div className="flex gap-2">
                    {current.action && (
                        <button onClick={handleAction} className="btn-primary btn-sm">
                            {current.action}
                        </button>
                    )}
                    {isLast ? (
                        <button onClick={handleDismiss} className="btn-primary btn-sm">
                            시작하기 🎉
                        </button>
                    ) : (
                        <button onClick={() => setStep(s => s + 1)} className="btn-secondary btn-sm">
                            다음 →
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

/** 위자드를 표시할지 판단하는 헬퍼 */
AdminOnboardingWizard.shouldShow = (vehicleCount: number, employeeCount: number) => {
    try {
        if (localStorage.getItem(LS_KEY) === 'true') return false;
    } catch { /* noop */ }
    // 차량이 0대이고 직원이 본인 1명뿐일 때 표시
    return vehicleCount === 0 && employeeCount <= 1;
};
