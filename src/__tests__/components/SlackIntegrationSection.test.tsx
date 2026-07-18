import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SlackIntegrationSection from '../../components/admin/settings/SlackIntegrationSection';
import type { SlackStatus, SlackStaffReadiness } from '../../hooks/useSlackIntegration';

// 훅 전체 mock — 컴포넌트는 상태별 렌더·액션 위임만 검증한다
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockDiagnose = vi.fn();
let hookState: {
    status: SlackStatus | null;
    staff: SlackStaffReadiness[] | null;
    connecting: boolean; diagnosing: boolean; disconnecting: boolean;
};
vi.mock('../../hooks/useSlackIntegration', () => ({
    useSlackIntegration: () => ({
        ...hookState,
        connect: mockConnect, disconnect: mockDisconnect, diagnose: mockDiagnose,
    }),
}));

function setState(overrides: Partial<typeof hookState> = {}) {
    hookState = {
        status: { connected: false },
        staff: null,
        connecting: false, diagnosing: false, disconnecting: false,
        ...overrides,
    };
}

describe('SlackIntegrationSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setState();
    });

    it('미연결: 체크리스트와 연결 버튼을 보여준다', () => {
        render(<SlackIntegrationSection />);

        expect(screen.getByText('미연결')).toBeInTheDocument();
        expect(screen.getByText('직원의 Slack 이메일 = 차량운행일지 가입 이메일')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Slack에 연결하기/ })).toBeInTheDocument();
    });

    it('연결 버튼 클릭 시 connect를 호출한다', () => {
        render(<SlackIntegrationSection />);
        fireEvent.click(screen.getByRole('button', { name: /Slack에 연결하기/ }));
        expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('연결됨: 워크스페이스명·연결됨 배지·직원 준비 상태를 보여준다', () => {
        setState({
            status: { connected: true, teamName: '사랑나눔', connectedAt: '2026-07-18T00:00:00.000Z' },
            staff: [
                { name: '이철수', email: 'c@other.kr', matched: false },
                { name: '김영희', email: 'a@org.kr', matched: true },
            ],
        });
        render(<SlackIntegrationSection />);

        expect(screen.getByText('● 연결됨')).toBeInTheDocument();
        expect(screen.getByText('사랑나눔')).toBeInTheDocument();
        expect(screen.getByText('2명 중 1명 준비됨')).toBeInTheDocument();
        expect(screen.getByText('Slack 이메일 불일치')).toBeInTheDocument();
        // 불일치 안내 문구
        expect(screen.getByText(/앱 가입 이메일과 동일하게/)).toBeInTheDocument();
    });

    it('연결 해제는 2단계 확인 후에만 disconnect를 호출한다', () => {
        setState({ status: { connected: true, teamName: '사랑나눔' }, staff: [] });
        render(<SlackIntegrationSection />);

        fireEvent.click(screen.getByRole('button', { name: '연결 해제' }));
        expect(mockDisconnect).not.toHaveBeenCalled(); // 1차 클릭은 확인 단계만

        fireEvent.click(screen.getByRole('button', { name: '해제 확인' }));
        expect(mockDisconnect).toHaveBeenCalledTimes(1);
    });

    it('연결 테스트 버튼은 diagnose를 호출한다', () => {
        setState({ status: { connected: true, teamName: '사랑나눔' }, staff: [] });
        render(<SlackIntegrationSection />);

        fireEvent.click(screen.getByRole('button', { name: /연결 테스트/ }));
        expect(mockDiagnose).toHaveBeenCalledTimes(1);
    });

    it('모두 준비된 경우 불일치 안내를 표시하지 않는다', () => {
        setState({
            status: { connected: true, teamName: '사랑나눔' },
            staff: [{ name: '김영희', email: 'a@org.kr', matched: true }],
        });
        render(<SlackIntegrationSection />);

        expect(screen.getByText('1명 중 1명 준비됨')).toBeInTheDocument();
        expect(screen.queryByText(/앱 가입 이메일과 동일하게/)).not.toBeInTheDocument();
    });
});
