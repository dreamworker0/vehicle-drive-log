/**
 * CalendarSyncTroubleshootModal — 캘린더 연동 문제 해결 모달
 *
 * '보기' 권한 공유는 실패 카운터가 쌓이지 않는다(역동기화가 성공해 늘 0으로 돌아온다).
 * 그 상태에서 'N회 연속 실패'라고 요약하면 거짓이고, 관리자는 무엇을 고칠지 모른다
 * (2026-10-28 이용 기관 신고). 상태별 요약 문구와 연동 테스트 결과 표시를 고정한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Vehicle } from '../../types/vehicle';

const mocks = vi.hoisted(() => ({ callable: vi.fn() }));

vi.mock('firebase/functions', () => ({ httpsCallable: () => mocks.callable }));
vi.mock('../../lib/firebase', () => ({ firebaseFunctions: {}, db: {}, auth: {} }));

import CalendarSyncTroubleshootModal from '../../components/admin/CalendarSyncTroubleshootModal';

function vehicle(over: Partial<Vehicle> = {}): Vehicle {
    return {
        id: 'v1', organizationId: 'org1', name: '스타렉스', displayName: '스타렉스',
        plateNumber: '77주2158', currentKm: 0, googleCalendarId: 'c_1@resource.calendar.google.com',
        ...over,
    } as Vehicle;
}

const renderModal = (v: Vehicle, onCalendarTestResult = vi.fn().mockResolvedValue(undefined)) => {
    render(<CalendarSyncTroubleshootModal vehicle={v} onClose={vi.fn()} onGoToEdit={vi.fn()} onCalendarTestResult={onCalendarTestResult} />);
    return { onCalendarTestResult };
};

beforeEach(() => vi.clearAllMocks());

describe('현재 상태 요약', () => {
    it('보기 권한 공유면 연속 실패 대신 쓰기 권한이 없다고 알린다', () => {
        renderModal(vehicle({ calendarAccessRole: 'reader', calendarSyncFailCount: 0 }));

        expect(screen.getByText(/캘린더에 일정을 쓸 권한이 없습니다/)).toBeInTheDocument();
        expect(screen.queryByText(/연속 실패/)).not.toBeInTheDocument();
    });

    it('실패가 배지 임계를 넘었으면 기존 실패 요약을 보인다', () => {
        renderModal(vehicle({ calendarAccessRole: 'reader', calendarSyncFailCount: 3 }));

        expect(screen.getByText(/3회 연속 실패/)).toBeInTheDocument();
        expect(screen.queryByText(/캘린더에 일정을 쓸 권한이 없습니다/)).not.toBeInTheDocument();
    });
});

describe('연동 테스트', () => {
    it('서버가 보기 권한이라고 답하면 실패로 표시하고 성공으로 기록하지 않는다', async () => {
        mocks.callable.mockResolvedValue({
            data: { success: false, errorType: 'READ_ONLY', errorTitle: '보기 권한으로만 공유되어 있음', message: "권한을 '일정 변경'으로 바꿔주세요." },
        });
        const { onCalendarTestResult } = renderModal(vehicle({ calendarAccessRole: 'reader' }));

        fireEvent.click(screen.getByRole('button', { name: /연동 테스트/ }));

        await waitFor(() => expect(screen.getByText(/보기 권한으로만 공유되어 있음/)).toBeInTheDocument());
        expect(onCalendarTestResult).toHaveBeenCalledWith('v1', false);
    });
});
