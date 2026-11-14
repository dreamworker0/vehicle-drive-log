import { useId, useState, type FormEvent, type ReactNode } from 'react';

export interface DateRangeSearchProps {
    /** 지금 조회에 적용된 기간 */
    startDate: string;
    endDate: string;
    /** [검색]을 눌렀을 때만 부른다 */
    onSearch: (startDate: string, endDate: string) => void;
    /** 버튼 옆에 붙일 요소 (초기화 버튼 등) */
    children?: ReactNode;
}

/**
 * 일지 관리·정비 기록의 기간 필터 — 날짜를 고른 뒤 [검색]을 눌러야 조회한다.
 *
 * 예전에는 날짜가 바뀌는 즉시 조회했다. 크롬·엣지 달력은 화살표로 달만 넘겨도 값이 바뀌어,
 * 시작일만 전달로 옮겨 간 채 검색 결과가 바뀌어 헷갈린다는 문의가 있었다(2026-11-03 궁동종합사회복지관).
 * 날짜를 바꿀 때마다 Firestore 조회가 한 번씩 나가던 것도 함께 줄어든다.
 */
export default function DateRangeSearch({ startDate, endDate, onSearch, children }: DateRangeSearchProps) {
    const [draftStart, setDraftStart] = useState(startDate);
    const [draftEnd, setDraftEnd] = useState(endDate);

    // 적용된 기간이 바깥에서 바뀌면(검색·초기화) 입력 중이던 값을 새 값으로 맞춘다.
    // 예전에는 key로 폼을 통째로 다시 만들어 [검색]·Enter 직후 포커스가 페이지 맨 위로 튕겼다.
    // 렌더 중에 이전 값과 비교해 state만 맞추면 DOM이 그대로라 포커스가 남는다.
    const [applied, setApplied] = useState({ startDate, endDate });
    if (applied.startDate !== startDate || applied.endDate !== endDate) {
        setApplied({ startDate, endDate });
        setDraftStart(startDate);
        setDraftEnd(endDate);
    }

    const changed = draftStart !== startDate || draftEnd !== endDate;
    const hintId = useId();

    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();
        onSearch(draftStart, draftEnd);
    };

    return (
        <form onSubmit={handleSubmit} className="mt-3">
            <div className="flex items-center gap-2">
                <span className="text-xs text-surface-500 dark:text-surface-400 whitespace-nowrap">기간</span>
                <input
                    type="date"
                    aria-label="시작일"
                    value={draftStart}
                    onChange={e => setDraftStart(e.target.value)}
                    className="input text-sm flex-1 min-w-0 min-h-[48px]"
                />
                <span className="text-surface-300 dark:text-surface-600">~</span>
                <input
                    type="date"
                    aria-label="종료일"
                    value={draftEnd}
                    onChange={e => setDraftEnd(e.target.value)}
                    className="input text-sm flex-1 min-w-0 min-h-[48px]"
                />
                {/* 아직 적용하지 않은 날짜가 있으면 진한 색으로 바꿔 눌러야 한다는 걸 알린다 */}
                <button
                    type="submit"
                    aria-describedby={changed ? hintId : undefined}
                    className={`${changed ? 'btn-primary' : 'btn-soft-primary'} px-3 text-sm whitespace-nowrap min-h-[48px]`}
                >
                    검색
                </button>
                {children}
            </div>
            {/* 색만으로는 놓치기 쉽고 화면낭독기로는 알 수 없어 글로도 알린다.
                입력칸의 날짜와 목록·내보내기 기간이 다른 상태라는 뜻이다.
                알림 영역은 비운 채 먼저 그려 두어야 문구가 생길 때 읽어 준다(숨기면 못 읽는 낭독기가 있어 여백만 없앤다). */}
            <p id={hintId} role="status" className="text-xs text-primary-600 dark:text-primary-400 mt-1.5 empty:mt-0">
                {changed ? '바꾼 기간은 [검색]을 눌러야 목록에 적용돼요' : ''}
            </p>
        </form>
    );
}
