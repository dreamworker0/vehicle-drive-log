import { useNavigate } from 'react-router-dom';
import { useReservationPattern } from '../../hooks/useReservationPattern';

export default function ReservationPatternBanner() {
    const { recommended, loading } = useReservationPattern();
    const navigate = useNavigate();

    if (loading || !recommended || recommended.length === 0) return null;

    const handleQuickReserve = (pattern: any) => {
        // 예약 라우트로 이동하며, 위치 폼을 열기 위한 state 조작
        navigate('/employee/reservations', {
            state: {
                openForm: true,
                prefillPattern: pattern
            }
        });
    };

    return (
        <div className="mt-6 animate-fade-in-up">
            {/* 섹션 타이틀 */}
            <div className="flex items-center gap-2 mb-3">
                <h2 className="text-lg font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
                    원클릭 추천 예약
                </h2>
                <span className="inline-block px-1.5 py-0.5 text-[0.65rem] font-medium text-surface-500 bg-surface-100 border border-surface-200 rounded-md dark:bg-surface-800 dark:border-surface-700 dark:text-surface-400">
                    패턴 분석
                </span>
            </div>

            {/* 추천 항목 리스트 */}
            <div className="flex flex-row overflow-x-auto snap-x snap-mandatory space-x-3 pb-2 -mx-4 px-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
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
                            className="glass-card px-4 py-3 flex items-center justify-between gap-3 shrink-0 min-w-[85%] snap-center transition-colors hover:shadow-md"
                        >
                            <div className="flex items-center gap-3 min-w-0 pr-2">
                                <span className="flex-shrink-0 text-sm font-bold text-indigo-600 dark:text-indigo-400">
                                    {idx + 1}.
                                </span>
                                <div className="min-w-0 text-left">
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
                                className="relative z-10 inline-flex items-center justify-center shrink-0 min-w-[60px] px-3 py-1.5 text-xs font-semibold text-white transition-colors rounded-lg bg-primary-600 hover:bg-primary-700 whitespace-nowrap"
                            >
                                예약
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
