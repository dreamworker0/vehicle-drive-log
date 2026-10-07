import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * 종료시간 잠금(`endTimeTouched`)이 **내려가는지**를 고정한다.
 *
 * 이 변경의 회귀 위험은 신고와 반대 방향에 있다 — 잠금이 남으면 신규 작성에서 경로 자동
 * 계산이 영영 돌지 않는다. 훅 안에서 잠금이 풀리면 다시 채워지는 것은 useRouteInfo.test.ts가
 * 보고, 여기서는 **폼을 새로 여는 길들이 실제로 잠금을 내리는지**를 본다(머지 전 리뷰가
 * "테스트로 박았다고 적어 놓고 리셋 경로는 아무도 확인하지 않는다"고 지적한 자리).
 */

const mockSearchParams = new URLSearchParams();
vi.mock('react-router-dom', () => ({
    useSearchParams: () => [mockSearchParams],
    useLocation: () => ({ state: null, pathname: '/employee/reservations' }),
}));

import { useReservationForm } from '../../hooks/reservationCalendar/useReservationForm';

const TODAY = new Date().toISOString().slice(0, 10);

/** 수정 진입을 흉내 내 잠금을 걸어 둔다 */
function lockedForm() {
    const view = renderHook(() => useReservationForm());
    act(() => { view.result.current.setEndTimeTouched(true); });
    expect(view.result.current.endTimeTouched).toBe(true);
    return view;
}

describe('useReservationForm — 종료시간 잠금 해제', () => {
    it('resetFormState가 잠금을 내린다 — 저장 성공 뒤 다음 예약이 막히면 안 된다', () => {
        const { result } = lockedForm();

        act(() => { result.current.resetFormState(); });

        expect(result.current.endTimeTouched).toBe(false);
    });

    it('폼을 닫으면 잠금을 내린다', () => {
        const { result } = lockedForm();
        act(() => { result.current.handleOpenForm(); });   // 닫혀 있으면 연다
        expect(result.current.showForm).toBe(true);

        act(() => { result.current.handleOpenForm(); });   // 다시 누르면 닫는다

        expect(result.current.showForm).toBe(false);
        expect(result.current.endTimeTouched).toBe(false);
    });

    it('폼이 닫힌 채 날짜를 고르면 잠금을 내린다', () => {
        const { result } = lockedForm();

        act(() => { result.current.handleDateSelect(TODAY); });

        expect(result.current.endTimeTouched).toBe(false);
    });

    it('폼이 열린 채 날짜만 바꾸면 잠금을 유지한다 — 화면의 값은 사람이 넣은 그대로다', () => {
        // 폼도 입력값도 그대로 두는 것이 이 경로의 의도다(주석에 적혀 있다). 값이 남아 있는데
        // 잠금만 풀면 그 값이 곧 덮인다 — 신고받은 바로 그 증상이다.
        const { result } = renderHook(() => useReservationForm());
        act(() => { result.current.handleOpenForm(); });
        act(() => { result.current.setEndTimeTouched(true); });

        act(() => { result.current.handleDateSelect(TODAY); });

        expect(result.current.showForm).toBe(true);
        expect(result.current.endTimeTouched).toBe(true);
    });
});
