import { useState, useRef, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { useReservationPattern } from '../../hooks/useReservationPattern';
import useVerticalOverlap from '../../hooks/useVerticalOverlap';

interface ReservationPatternBannerProps {
    /** 겹침을 감지할 기준 요소(이번 주 예약 목록)의 ref */
    anchorRef?: RefObject<HTMLElement | null>;
}

export default function ReservationPatternBanner({ anchorRef }: ReservationPatternBannerProps = {}) {
    const { recommended, loading } = useReservationPattern();
    const navigate = useNavigate();
    const [isDismissed, setIsDismissed] = useState(false);
    const bannerRef = useRef<HTMLDivElement>(null);
    const fallbackRef = useRef<HTMLElement>(null);
    // "이번 주 예약"과 화면에서 세로로 겹칠 때만 확장 배너를 숨긴다
    const overlap = useVerticalOverlap(anchorRef ?? fallbackRef, bannerRef);

    if (loading || !recommended || recommended.length === 0) return null;

    if (isDismissed) {
        return (
            <button
                onClick={() => setIsDismissed(false)}
                // 펼침 배너와 같은 층(z-40). 하단 내비(z-30) 위, 헤더(z-45)·모달(z-50) 아래다.
                // 예전의 z-index 90이던 동안에는 이 작은 버튼이 알림 패널은 물론 모달까지 덮고 있었다.
                className="fixed bottom-[85px] right-4 z-40 flex items-center justify-center w-12 h-12 min-w-[48px] min-h-[48px] bg-surface-100 dark:bg-surface-800/70 backdrop-blur-md text-primary-600 dark:text-primary-400 border border-surface-200/50 dark:border-surface-700/50 rounded-full shadow-sm hover:bg-surface-200/80 dark:hover:bg-surface-700/80 transition-all active:scale-95 animate-fade-in-up md:right-8"
                title="추천 예약 켜기"
            >
                <div className="relative">
                    <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
        <div
            ref={bannerRef}
            className={`fixed bottom-[85px] left-0 right-0 z-[40] pointer-events-none transition-opacity ${overlap ? 'opacity-0 invisible' : 'opacity-100'}`}
        >
            <div className="max-w-screen-md mx-auto px-4 w-full">
                <div className="max-w-lg mx-auto animate-fade-in-up">
                    {/* 추천 항목 — 한 줄짜리 작은 카드. 추천 예약은 예약의 1% 남짓이라 첫 화면을 크게 차지하지 않게 줄였다.
                        제목 줄을 없애고 '💡 추천' 표시와 닫기 버튼을 카드 줄 안으로 옮겼다. */}
                    <div className="flex items-center gap-2 pointer-events-auto">
                    <div className="flex-1 min-w-0 flex flex-row overflow-x-auto snap-x snap-mandatory space-x-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
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
                                <button
                                    key={`${rec.date}-${rec.startTime}-${idx}`}
                                    onClick={() => handleQuickReserve(rec)}
                                    className="glass-card pl-3 pr-2 min-h-[48px] flex items-center gap-2 shrink-0 w-full snap-center text-left transition-colors hover:shadow-md"
                                    aria-label={`추천 예약: ${rec.vehicleName} ${month}월 ${date}일 ${rec.startTime}`}
                                >
                                    <span className="text-sm flex-shrink-0" aria-hidden="true">💡</span>
                                    <span className="min-w-0 flex-1 text-xs truncate text-surface-600 dark:text-surface-300">
                                        <span className="font-medium text-surface-800 dark:text-surface-200">{rec.vehicleName}</span>
                                        {' '}· {month}.{date}({koWeekday}) {rec.startTime}
                                        <span className="text-primary-500 dark:text-primary-400"> · {weekPrefix}</span>
                                    </span>
                                    <span className="flex-shrink-0 px-2.5 py-1 rounded-lg text-xs font-semibold text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30">
                                        추천 예약
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                    <button
                        onClick={() => setIsDismissed(true)}
                        className="glass-card flex-shrink-0 min-w-[48px] min-h-[48px] flex items-center justify-center text-surface-400 dark:text-surface-500 hover:text-surface-800 dark:hover:text-surface-200 transition-colors"
                        title="닫기"
                        aria-label="추천 예약 닫기"
                    >
                        <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
