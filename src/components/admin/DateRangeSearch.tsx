import { useState, type FormEvent, type ReactNode } from 'react';

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
 * 일지 관리의 기간 필터 — 날짜를 고른 뒤 [검색]을 눌러야 조회한다.
 *
 * 예전에는 날짜가 바뀌는 즉시 조회했다. 크롬·엣지 달력은 화살표로 달만 넘겨도 값이 바뀌어,
 * 시작일만 전달로 옮겨 간 채 검색 결과가 바뀌어 헷갈린다는 문의가 있었다(2026-11-03 궁동종합사회복지관).
 * 날짜를 바꿀 때마다 Firestore 조회가 한 번씩 나가던 것도 함께 줄어든다.
 */
export default function DateRangeSearch(props: DateRangeSearchProps) {
    // 적용된 기간이 바깥에서 바뀌면(초기화 등) 입력 중이던 값을 버리고 새 값으로 다시 시작한다
    return <DateRangeSearchForm key={`${props.startDate}|${props.endDate}`} {...props} />;
}

function DateRangeSearchForm({ startDate, endDate, onSearch, children }: DateRangeSearchProps) {
    const [draftStart, setDraftStart] = useState(startDate);
    const [draftEnd, setDraftEnd] = useState(endDate);
    const changed = draftStart !== startDate || draftEnd !== endDate;

    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();
        onSearch(draftStart, draftEnd);
    };

    return (
        <form onSubmit={handleSubmit} className="flex items-center gap-2 mt-3">
            <span className="text-xs text-surface-400 dark:text-surface-500 whitespace-nowrap">기간</span>
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
            {/* 아직 적용하지 않은 날짜가 있으면 눈에 띄게 바꿔 눌러야 한다는 걸 알린다 */}
            <button
                type="submit"
                className={`${changed ? 'btn-primary' : 'btn-soft-primary'} px-3 text-sm whitespace-nowrap min-h-[48px]`}
            >
                검색
            </button>
            {children}
        </form>
    );
}
