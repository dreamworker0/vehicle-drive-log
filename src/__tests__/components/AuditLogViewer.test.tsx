/**
 * AuditLogViewer — 접속기록 점검 화면
 *
 * 고정하는 계약:
 *  (1) 유형별로 남아 있는 항목만 사람이 읽는 말로 보여준다 (IP·반출 형식·바뀐 항목)
 *  (2) 행위자 uid는 이름으로 바꿔 보여준다
 *  (3) 기록의 신뢰 수준(행위자 미확인)을 숨기지 않는다
 *  (4) 기간·유형 버튼이 훅의 필터를 바꾼다
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AuditLog } from '../../types/auditLog';
import type { UseAuditLogsResult } from '../../hooks/useAuditLogs';

const hookState = vi.hoisted(() => ({
    value: null as unknown as UseAuditLogsResult,
}));

vi.mock('../../hooks/useAuditLogs', async () => {
    const actual = await vi.importActual<typeof import('../../hooks/useAuditLogs')>('../../hooks/useAuditLogs');
    return {
        ...actual,
        default: () => hookState.value,
    };
});

import AuditLogViewer from '../../components/admin/AuditLogViewer';

const at = { toDate: () => new Date('2026-08-02T14:05:00') } as unknown as AuditLog['at'];

const log = (over: Partial<AuditLog>): AuditLog => ({
    id: 'l1',
    organizationId: 'org-1',
    action: 'update',
    targetType: 'driveLog',
    targetId: 'dl-1',
    actorUid: 'u1',
    actorSource: 'stamp',
    subjectUids: [],
    at,
    expiresAt: at,
    ...over,
});

const setHook = (over: Partial<UseAuditLogsResult> = {}) => {
    hookState.value = {
        logs: [],
        loading: false,
        loadingMore: false,
        error: '',
        hasMore: false,
        kind: 'all',
        setKind: vi.fn(),
        days: 30,
        setDays: vi.fn(),
        loadMore: vi.fn(),
        nameOf: (uid) => (uid === 'u1' ? '김간사' : uid === 'u2' ? '이팀장' : '알 수 없음'),
        ...over,
    };
    return hookState.value;
};

beforeEach(() => {
    vi.clearAllMocks();
    setHook();
});

describe('AuditLogViewer', () => {
    it('기록이 없으면 기간을 넓히도록 안내한다', () => {
        render(<AuditLogViewer />);
        expect(screen.getByText('선택한 기간에 기록이 없습니다.')).toBeInTheDocument();
    });

    it('접속 기록은 IP와 접속 환경을 보여준다', () => {
        setHook({
            logs: [log({
                action: 'login', targetType: 'session', actorSource: 'auth',
                ip: '203.0.113.7', userAgent: 'Chrome / Android',
            })],
        });
        render(<AuditLogViewer />);

        expect(screen.getByText('로그인 접속')).toBeInTheDocument();
        expect(screen.getByText('203.0.113.7')).toBeInTheDocument();
        expect(screen.getByText('Chrome / Android')).toBeInTheDocument();
        expect(screen.getByText('김간사')).toBeInTheDocument();
    });

    it('반출 기록은 대상·형식·건수를 사람이 읽는 말로 보여준다', () => {
        setHook({
            logs: [log({
                action: 'export', targetType: 'export', actorSource: 'auth',
                exportFormat: 'excel', exportDataset: 'driveLogs', recordCount: 1320,
            })],
        });
        render(<AuditLogViewer />);

        expect(screen.getByText('내보내기 반출')).toBeInTheDocument();
        expect(screen.getByText('운행일지 · 엑셀 파일')).toBeInTheDocument();
        expect(screen.getByText('1,320건')).toBeInTheDocument();
    });

    it('변경 기록은 바뀐 항목을 한글로, 대상 직원을 이름으로 보여준다', () => {
        setHook({
            logs: [log({ changedFields: ['destination', 'passengerNames'], subjectUids: ['u1', 'u2'] })],
        });
        render(<AuditLogViewer />);

        expect(screen.getByText('운행일지 수정')).toBeInTheDocument();
        expect(screen.getByText('목적지, 탑승자')).toBeInTheDocument();
        expect(screen.getByText('김간사, 이팀장')).toBeInTheDocument();
    });

    it('행위자를 확정할 수 없는 기록은 그 사실을 표시한다', () => {
        setHook({ logs: [log({ action: 'delete', actorUid: null, actorSource: 'unknown' })] });
        render(<AuditLogViewer />);

        expect(screen.getByText('운행일지 삭제')).toBeInTheDocument();
        expect(screen.getByText('(행위자 미확인)')).toBeInTheDocument();
    });

    it('기간·유형 버튼이 훅의 필터를 바꾼다', () => {
        const state = setHook();
        render(<AuditLogViewer />);

        fireEvent.click(screen.getByRole('button', { name: '최근 90일' }));
        expect(state.setDays).toHaveBeenCalledWith(90);

        fireEvent.click(screen.getByRole('button', { name: '반출·열람' }));
        expect(state.setKind).toHaveBeenCalledWith('export');
    });

    it('더 볼 기록이 있으면 더 보기 버튼을 노출한다', () => {
        const state = setHook({ logs: [log({})], hasMore: true });
        render(<AuditLogViewer />);

        fireEvent.click(screen.getByRole('button', { name: '이전 기록 더 보기' }));
        expect(state.loadMore).toHaveBeenCalled();
    });

    it('조회 실패 문구를 그대로 노출한다', () => {
        setHook({ error: '접속기록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.' });
        render(<AuditLogViewer />);
        expect(screen.getByText('접속기록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.')).toBeInTheDocument();
    });

    it("조회 실패를 '기록 없음'으로 오해시키지 않는다 — 빈 상태 안내를 함께 띄우지 않는다", () => {
        // 인덱스 미생성(failed-precondition)으로 실패한 실제 화면에서 오류 문구와
        // "선택한 기간에 기록이 없습니다"가 동시에 떠 실패가 '기록 없음'처럼 보였다.
        setHook({ error: '접속기록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.' });
        render(<AuditLogViewer />);
        expect(screen.queryByText('선택한 기간에 기록이 없습니다.')).not.toBeInTheDocument();
    });
});
