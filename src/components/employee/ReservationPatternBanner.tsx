import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useReservationPattern } from '../../hooks/useReservationPattern';

export default function ReservationPatternBanner() {
    const { recommended, loading } = useReservationPattern();
    const navigate = useNavigate();
    const [isDismissed, setIsDismissed] = useState(false);

    if (loading || !recommended || recommended.length === 0) return null;

    if (isDismissed) {
        return (
            <button
                onClick={() => setIsDismissed(false)}
                className="fixed bottom-[85px] right-4 z-[90] flex items-center justify-center w-11 h-11 bg-surface-100/70 dark:bg-surface-800/70 backdrop-blur-md text-primary-600 dark:text-primary-400 border border-surface-200/50 dark:border-surface-700/50 rounded-full shadow-sm hover:bg-surface-200/80 dark:hover:bg-surface-700/80 transition-all active:scale-95 animate-fade-in-up md:right-8"
                title="추천 예약 켜기"
            >
                <div className="relative">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    {/* 작고 부드러운 뱃지 */}
                    <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2 rounded-full bg-primary-400 ring-2 ring-surface-100 dark:ring-surface-800"></span>
                </div>
            </button>
        );
    }

    const handleQuickReserve = (pattern: (typeof recommended)[number]) => {
        // 예약 라우트로 이동하며, 위치 폼을 열기 위한 state 조작 및 추천 예약 출처 기록
        navigate('/employee/reservations', {
            state: {
                openForm: true,
                prefillPattern: pattern,
                source: 'recommendation'
            }
        });
    };

    return (
        <div className="fixed bottom-[85px] left-0 right-0 z-[40] pointer-events-none">
            <div className="max-w-screen-md mx-auto px-4 w-full">
                <div className="max-w-lg mx-auto animate-fade-in-up">
                    {/* 섹션 타이틀 */}
                    <div className="flex items-center justify-between mb-3 pointer-events-auto">
                        <div className="flex items-center gap-2">
                            <h2 className="text-lg font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
                                원클릭 추천 예약
                            </h2>
                            <span className="inline-block px-1.5 py-0.5 text-[0.65rem] font-medium text-surface-500 bg-surface-100 border border-surface-200 rounded-md dark:bg-surface-800 dark:border-surface-700 dark:text-surface-400">
                                패턴 분석
                            </span>
                        </div>
                        {/* 닫기 버튼 */}
                        <button
                            onClick={() => setIsDismissed(true)}
                            className="p-1 rounded-full text-surface-400 dark:text-surface-500 hover:text-surface-800 hover:bg-surface-200 dark:hover:text-surface-200 dark:hover:bg-surface-700 transition-colors"
                            title="닫기"
                            aria-label="추천 예약 닫기"
                        >
                            <svg className="w-5 h-5 opacity-50 hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    {/* 추천 항목 리스트 */}
                    <div className="flex flex-row overflow-x-auto snap-x snap-mandatory space-x-3 pb-2 -mx-4 px-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] pointer-events-auto">
                        {recommended.map((rec, idx) => {
                            const days = ['일', '월', '화', '수', '목', '금', '토'];
                            const koWeekday = days[rec.dayOfWeekRaw];

                            const dateObj = new Date(rec.date + 'T00:00:00');
                            const month = dateObj.getMonth() + 1;
                            const date = dateObj.getDate();

                            const today = new Date();
                            today.setHours(0, 0, 0, 0);
                            const diffDays = Math.floor((dateObj.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

                            let weekPrefix = "이번주";
                            if (diffDays >= 7 && diffDays < 14) {
                                weekPrefix = "다음주";
                            } else if (diffDays >= 14 && diffDays < 21) {
                                weekPrefix = "다다음주";
                            } else if (diffDays >= 21) {
                                const weeks = Math.floor(diffDays / 7);
                                weekPrefix = `${weeks}주 뒤`;
                            }

                            return (
                                <div
                                    key={`${rec.date}-${rec.startTime}-${idx}`}
                                    className="glass-card px-4 py-3 flex items-center justify-between gap-3 shrink-0 w-[85%] snap-center transition-colors hover:shadow-md"
                                >
                                    <div className="flex items-center gap-3 min-w-0 pr-2 flex-1">
                                        <div className="min-w-0 text-left flex-1">
                                            <p className="text-sm font-medium truncate text-surface-800 dark:text-surface-200">
                                                {rec.vehicleName}
                                            </p>
                                            <p className="text-xs truncate text-surface-500 dark:text-surface-400 mt-0.5">
                                                {month}.{date} ({koWeekday}) {rec.startTime} <span className="text-primary-500 font-medium ml-1">· {weekPrefix}</span>
                                                {rec.destination ? ` · ${rec.destination}` : ''}
                                            </p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleQuickReserve(rec)}
                                        className="relative z-10 inline-flex items-center justify-center shrink-0 min-w-[65px] px-2.5 py-1.5 text-[11px] font-bold text-white transition-colors rounded-lg bg-primary-600 hover:bg-primary-700 whitespace-nowrap"
                                    >
                                        + 미리예약
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
