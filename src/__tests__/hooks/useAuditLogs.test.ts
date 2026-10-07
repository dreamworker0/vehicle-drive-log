/**
 * useAuditLogs — 접속기록 점검 조회 훅
 *
 * 고정하는 계약:
 *  (1) 기관이 없으면 조회하지 않는다 (다른 기관 기록을 볼 경로를 만들지 않는다)
 *  (2) 기간·유형이 바뀌면 첫 페이지부터 다시 읽는다 (커서가 섞이면 목록이 어긋난다)
 *  (3) 더 보기는 커서로 이어 붙인다
 *  (4) uid는 구성원 이름으로 바꿔 보여주고, 모르는 uid는 축약해 표시한다
 *  (5) 조회 실패는 화면 문구로 알린다 (빈 목록으로 위장하지 않는다)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    getAuditLogs: vi.fn(),
    getAuditLogsForExport: vi.fn(),
    getOrganizationMembers: vi.fn(),
    getDriveLogsByIds: vi.fn(),
    getVehicles: vi.fn(),
    getVehicleDriveLogs: vi.fn(),
    getAuditLogsByTargets: vi.fn(),
    getReservationsByIds: vi.fn(),
    downloadAuditLogsExcel: vi.fn(),
    auth: { userData: null as { organizationId?: string | null } | null },
    captureError: vi.fn(),
}));

vi.mock('../../lib/firestore', () => ({
    getAuditLogs: mocks.getAuditLogs,
    getAuditLogsForExport: mocks.getAuditLogsForExport,
    getOrganizationMembers: mocks.getOrganizationMembers,
    getDriveLogsByIds: mocks.getDriveLogsByIds,
    getVehicles: mocks.getVehicles,
    getVehicleDriveLogs: mocks.getVehicleDriveLogs,
    getAuditLogsByTargets: mocks.getAuditLogsByTargets,
    getReservationsByIds: mocks.getReservationsByIds,
    // 조건 적용은 auditLogs.test.ts가 따로 고정한다 — 여기서는 배선만 본다
    filterAuditLogs: (logs: unknown[]) => logs,
    auditLogAtMillis: (log: { at?: { ms?: number } }) => log.at?.ms ?? 0,
    AUDIT_VEHICLE_ID_SINCE: new Date('2026-10-06T00:00:00+09:00'),
    AUDIT_LOG_PAGE_SIZE: 50,
    AUDIT_LOG_EXPORT_MAX: 5000,
}));
vi.mock('../../lib/excelExport', () => ({ downloadAuditLogsExcel: mocks.downloadAuditLogsExcel }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../lib/sentry', () => ({ captureError: mocks.captureError }));

import useAuditLogs from '../../hooks/useAuditLogs';

const page = (ids: string[], hasMore = false) => ({
    logs: ids.map((id) => ({ id, action: 'login', targetType: 'session', subjectUids: [] })),
    lastDoc: ids.length ? { id: ids[ids.length - 1] } : null,
    hasMore,
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.userData = { organizationId: 'org-1' };
    mocks.getAuditLogs.mockResolvedValue(page(['a1', 'a2']));
    mocks.getOrganizationMembers.mockResolvedValue([
        { id: 'u1', name: '김간사', email: 'kim@x.or.kr' },
        { id: 'u2', name: '', email: 'lee@x.or.kr' },
    ]);
    mocks.getAuditLogsForExport.mockResolvedValue({ logs: page(['a1', 'a2']).logs, truncated: false });
    mocks.downloadAuditLogsExcel.mockResolvedValue(true);
    mocks.getDriveLogsByIds.mockResolvedValue(new Map());
    mocks.getVehicles.mockResolvedValue([
        { id: 'car-1', displayName: '스타리아', name: '스타리아', plateNumber: '12가3456' },
        { id: 'car-2', name: '레이', plateNumber: '34나5678' },
    ]);
    mocks.getVehicleDriveLogs.mockResolvedValue([]);
    mocks.getAuditLogsByTargets.mockResolvedValue([]);
    mocks.getReservationsByIds.mockResolvedValue(new Map());
});

describe('useAuditLogs', () => {
    it('기관이 없으면 조회하지 않는다', async () => {
        mocks.auth.userData = { organizationId: null };
        const { result } = renderHook(() => useAuditLogs());

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(mocks.getAuditLogs).not.toHaveBeenCalled();
        expect(result.current.logs).toEqual([]);
    });

    it('기본값은 최근 30일·전체 유형으로 조회한다', async () => {
        const { result } = renderHook(() => useAuditLogs());
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.days).toBe(30);
        expect(result.current.kind).toBe('all');
        const [orgId, options] = mocks.getAuditLogs.mock.calls[0];
        expect(orgId).toBe('org-1');
        expect(options.kind).toBe('all');
        // 30일 전후 오차를 허용해 '기간이 실제로 좁혀졌는지'만 고정한다
        const diffDays = (Date.now() - (options.since as Date).getTime()) / 86_400_000;
        expect(diffDays).toBeGreaterThan(29);
        expect(diffDays).toBeLessThan(31);
    });

    it('유형을 바꾸면 커서 없이 첫 페이지부터 다시 읽는다', async () => {
        const { result } = renderHook(() => useAuditLogs());
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => result.current.setKind('export'));
        await waitFor(() => expect(mocks.getAuditLogs).toHaveBeenCalledTimes(2));

        const [, options] = mocks.getAuditLogs.mock.calls[1];
        expect(options.kind).toBe('export');
        expect(options.startAfter).toBeUndefined();
    });

    describe('직원 필터', () => {
        it('기본은 전체 직원이고, 구성원을 이름순 선택지로 준다', async () => {
            const { result } = renderHook(() => useAuditLogs());
            await waitFor(() => expect(result.current.members).toHaveLength(2));

            expect(mocks.getAuditLogs.mock.calls[0][1].uid).toBeUndefined();
            expect(result.current.memberUid).toBe('');
            // 이름이 없으면 이메일로 — 선택지에 빈 줄이 생기지 않게
            expect(result.current.members).toEqual([
                { uid: 'u1', name: '김간사' },
                { uid: 'u2', name: 'lee@x.or.kr' },
            ]);
        });

        it('직원을 고르면 그 uid로 첫 페이지부터 다시 읽고, 더 보기에도 같은 필터를 쓴다', async () => {
            mocks.getAuditLogs.mockResolvedValue(page(['a1'], true));
            const { result } = renderHook(() => useAuditLogs());
            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => result.current.setMemberUid('u1'));
            await waitFor(() => expect(mocks.getAuditLogs).toHaveBeenCalledTimes(2));
            expect(mocks.getAuditLogs.mock.calls[1][1]).toMatchObject({ uid: 'u1' });
            expect(mocks.getAuditLogs.mock.calls[1][1].startAfter).toBeUndefined();
            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => result.current.loadMore());
            await waitFor(() => expect(mocks.getAuditLogs).toHaveBeenCalledTimes(3));
            expect(mocks.getAuditLogs.mock.calls[2][1]).toMatchObject({ uid: 'u1', startAfter: { id: 'a1' } });
        });

        it('직원을 골라 내보내면 같은 필터로 읽고 파일명에 이름을 붙인다', async () => {
            const { result } = renderHook(() => useAuditLogs());
            await waitFor(() => expect(result.current.members).toHaveLength(2));

            act(() => result.current.setMemberUid('u1'));
            await waitFor(() => expect(result.current.memberUid).toBe('u1'));
            act(() => result.current.exportExcel());
            await waitFor(() => expect(mocks.downloadAuditLogsExcel).toHaveBeenCalled());

            expect(mocks.getAuditLogsForExport.mock.calls[0][1]).toMatchObject({ uid: 'u1' });
            expect(mocks.downloadAuditLogsExcel.mock.calls[0][2]).toBe('접속기록_최근30일_김간사');
        });
    });

    describe('차량 필터', () => {
        it('차량 선택지는 표시명, 없으면 이름+번호판으로 만든다', async () => {
            const { result } = renderHook(() => useAuditLogs());
            await waitFor(() => expect(result.current.vehicles).toHaveLength(2));
            expect(result.current.vehicles).toEqual([
                { id: 'car-1', name: '스타리아' },
                { id: 'car-2', name: '레이 34나5678' },
            ]);
        });

        it('차량을 고르면 그 차량으로 다시 읽고, 직원 필터와 함께 쓸 수 있다', async () => {
            const { result } = renderHook(() => useAuditLogs());
            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => result.current.setVehicleId('car-1'));
            await waitFor(() => expect(mocks.getAuditLogs).toHaveBeenCalledTimes(2));
            expect(mocks.getAuditLogs.mock.calls[1][1]).toMatchObject({ vehicleId: 'car-1' });

            act(() => result.current.setMemberUid('u1'));
            await waitFor(() => expect(mocks.getAuditLogs).toHaveBeenCalledTimes(3));
            expect(mocks.getAuditLogs.mock.calls[2][1]).toMatchObject({ vehicleId: 'car-1', uid: 'u1' });
        });

        it('차량을 골라 내보내면 파일명에 차량 이름을 붙인다', async () => {
            const { result } = renderHook(() => useAuditLogs());
            await waitFor(() => expect(result.current.vehicles).toHaveLength(2));

            act(() => result.current.setVehicleId('car-1'));
            await waitFor(() => expect(result.current.vehicleId).toBe('car-1'));
            act(() => result.current.exportExcel());
            await waitFor(() => expect(mocks.downloadAuditLogsExcel).toHaveBeenCalled());

            expect(mocks.getAuditLogsForExport.mock.calls[0][1]).toMatchObject({ vehicleId: 'car-1' });
            expect(mocks.downloadAuditLogsExcel.mock.calls[0][2]).toBe('접속기록_최근30일_스타리아');
        });
    });

    describe('차량 필터 — 차량 정보가 없는 옛 기록', () => {
        const at = (iso: string) => ({ ms: new Date(iso).getTime() });
        const rec = (id: string, iso: string, over: Record<string, unknown> = {}) => ({
            id, action: 'update', targetType: 'driveLog', targetId: 'dl-1', subjectUids: [], at: at(iso), ...over,
        });

        it('차량의 운행일지 ID와 차량 ID로 옛 기록을 찾아 함께 보여 준다 (vehicleId가 있는 기록은 서버 조회 몫)', async () => {
            mocks.getAuditLogs.mockResolvedValue({ logs: [], lastDoc: null, hasMore: false });
            mocks.getVehicleDriveLogs.mockResolvedValue([{ id: 'dl-1' }, { id: 'dl-2' }]);
            mocks.getAuditLogsByTargets.mockResolvedValue([
                rec('old-1', '2026-09-30T02:00:00Z'),
                rec('new-1', '2026-10-07T02:00:00Z', { vehicleId: 'car-1' }),
            ]);
            const { result } = renderHook(() => useAuditLogs());
            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => result.current.setVehicleId('car-1'));
            await waitFor(() => expect(result.current.logs.map((l) => l.id)).toEqual(['old-1']));
            expect(mocks.getAuditLogsByTargets).toHaveBeenCalledWith('org-1', ['car-1', 'dl-1', 'dl-2']);
            // 운행일지는 기간 시작 1년 전부터 — 오래된 운행을 이번 기간에 고친 기록도 잡는다
            const [, vehicleId, lookbackSince] = mocks.getVehicleDriveLogs.mock.calls[0];
            expect(vehicleId).toBe('car-1');
            const calls = mocks.getAuditLogs.mock.calls;
            const sinceUsed = calls[calls.length - 1][1].since as Date;
            expect(sinceUsed.getTime() - (lookbackSince as Date).getTime()).toBe(365 * 86_400_000);
        });

        it('서버 조회가 더 남아 있으면 옛 기록은 지금까지 불러온 가장 오래된 시각까지만 섞는다', async () => {
            mocks.getAuditLogs.mockImplementation(async (_org: string, opts: { vehicleId?: string }) => (opts.vehicleId
                ? { logs: [rec('m1', '2026-10-08T00:00:00Z', { vehicleId: 'car-1' })], lastDoc: { id: 'm1' }, hasMore: true }
                : page(['a1'])));
            mocks.getAuditLogsByTargets.mockResolvedValue([rec('old-1', '2026-09-30T00:00:00Z')]);
            const { result } = renderHook(() => useAuditLogs());
            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => result.current.setVehicleId('car-1'));
            await waitFor(() => expect(mocks.getAuditLogsByTargets).toHaveBeenCalled());
            await waitFor(() => expect(result.current.logs.map((l) => l.id)).toEqual(['m1']));
        });

        it('옛 기록 조회가 실패해도 서버 조회 결과는 보여 주고 문구로 알린다', async () => {
            mocks.getAuditLogs.mockImplementation(async (_org: string, opts: { vehicleId?: string }) => (opts.vehicleId
                ? { logs: [rec('m1', '2026-10-08T00:00:00Z', { vehicleId: 'car-1' })], lastDoc: null, hasMore: false }
                : page(['a1'])));
            mocks.getVehicleDriveLogs.mockRejectedValue(new Error('offline'));
            const { result } = renderHook(() => useAuditLogs());
            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => result.current.setVehicleId('car-1'));
            await waitFor(() => expect(result.current.error).toContain('10월 5일 이전 기록'));
            await waitFor(() => expect(result.current.logs.map((l) => l.id)).toEqual(['m1']));
        });
    });

    it('기간을 바꾸면 다시 읽는다', async () => {
        const { result } = renderHook(() => useAuditLogs());
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => result.current.setDays(90));
        await waitFor(() => expect(mocks.getAuditLogs).toHaveBeenCalledTimes(2));

        const [, options] = mocks.getAuditLogs.mock.calls[1];
        const diffDays = (Date.now() - (options.since as Date).getTime()) / 86_400_000;
        expect(diffDays).toBeGreaterThan(89);
    });

    it('1년(365일) 기간도 그대로 서버 필터로 넘긴다', async () => {
        const { result } = renderHook(() => useAuditLogs());
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => result.current.setDays(365));
        await waitFor(() => expect(mocks.getAuditLogs).toHaveBeenCalledTimes(2));

        const [, options] = mocks.getAuditLogs.mock.calls[1];
        const diffDays = (Date.now() - (options.since as Date).getTime()) / 86_400_000;
        // 보관기간(1년)과 같은 범위까지 닿는지 고정한다
        expect(diffDays).toBeGreaterThan(364);
        expect(diffDays).toBeLessThan(367);
    });

    it('더 보기는 커서로 이어 붙인다', async () => {
        mocks.getAuditLogs.mockResolvedValueOnce(page(['a1', 'a2'], true));
        const { result } = renderHook(() => useAuditLogs());
        await waitFor(() => expect(result.current.hasMore).toBe(true));

        mocks.getAuditLogs.mockResolvedValueOnce(page(['a3']));
        act(() => result.current.loadMore());

        await waitFor(() => expect(result.current.logs).toHaveLength(3));
        const [, options] = mocks.getAuditLogs.mock.calls[1];
        expect(options.startAfter).toEqual({ id: 'a2' });
        expect(result.current.hasMore).toBe(false);
    });

    it('더 볼 것이 없으면 loadMore는 아무것도 하지 않는다', async () => {
        const { result } = renderHook(() => useAuditLogs());
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => result.current.loadMore());
        expect(mocks.getAuditLogs).toHaveBeenCalledTimes(1);
    });

    it('uid를 구성원 이름으로 바꾸고, 이름이 없으면 이메일로 대체한다', async () => {
        const { result } = renderHook(() => useAuditLogs());
        await waitFor(() => expect(result.current.nameOf('u1')).toBe('김간사'));
        expect(result.current.nameOf('u2')).toBe('lee@x.or.kr');
    });

    it('구성원이 아닌 uid는 축약해 표시하고, 없으면 알 수 없음으로 둔다', async () => {
        const { result } = renderHook(() => useAuditLogs());
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.nameOf('abcdef123456')).toBe('미확인 계정(abcdef)');
        expect(result.current.nameOf(null)).toBe('알 수 없음');
    });

    it('이름 조회가 실패해도 기록은 보여준다', async () => {
        mocks.getOrganizationMembers.mockRejectedValue(new Error('offline'));
        const { result } = renderHook(() => useAuditLogs());

        await waitFor(() => expect(result.current.logs).toHaveLength(2));
        expect(result.current.error).toBe('');
        expect(mocks.captureError).toHaveBeenCalled();
    });

    describe('직접 지정 기간', () => {
        it('시작·종료가 모두 채워지기 전에는 프리셋을 유지한다', async () => {
            const { result } = renderHook(() => useAuditLogs());
            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => result.current.setRange({ start: '2026-07-01' }));
            await waitFor(() => expect(result.current.rangeActive).toBe(false));
            // 한쪽만 입력된 중간 상태로 조회를 갈아치우면 타이핑 중에 목록이 몇 번씩 바뀐다
            expect(mocks.getAuditLogs).toHaveBeenCalledTimes(1);
        });

        it('양쪽이 채워지면 그 범위로 조회하고 종료일 하루를 포함한다', async () => {
            const { result } = renderHook(() => useAuditLogs());
            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => result.current.setRange({ start: '2026-07-01', end: '2026-07-31' }));
            await waitFor(() => expect(mocks.getAuditLogs).toHaveBeenCalledTimes(2));

            const [, options] = mocks.getAuditLogs.mock.calls[1];
            expect(result.current.rangeActive).toBe(true);
            expect((options.since as Date).toISOString()).toBe(new Date('2026-07-01T00:00:00').toISOString());
            // 종료일 23:59:59.999까지 — 마지막 날 기록이 빠지면 그 날은 점검에서 누락된다
            expect((options.until as Date).toISOString()).toBe(new Date('2026-07-31T23:59:59.999').toISOString());
        });

        it('시작일이 종료일보다 늦으면 적용하지 않는다', async () => {
            const { result } = renderHook(() => useAuditLogs());
            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => result.current.setRange({ start: '2026-07-31', end: '2026-07-01' }));
            await waitFor(() => expect(result.current.rangeActive).toBe(false));
        });
    });

    describe('엑셀 내보내기', () => {
        it('화면 목록이 아니라 기간 전체를 다시 읽어 내보낸다', async () => {
            const { result } = renderHook(() => useAuditLogs());
            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => result.current.exportExcel());
            await waitFor(() => expect(mocks.downloadAuditLogsExcel).toHaveBeenCalledTimes(1));

            const [orgId, options] = mocks.getAuditLogsForExport.mock.calls[0];
            expect(orgId).toBe('org-1');
            expect(options.kind).toBe('all');
            // 파일명에 기간이 들어가야 여러 번 받은 파일을 구분할 수 있다
            expect(mocks.downloadAuditLogsExcel.mock.calls[0][2]).toBe('접속기록_최근30일');
        });

        it('직접 지정 기간은 파일명에 시작·종료일을 쓴다', async () => {
            const { result } = renderHook(() => useAuditLogs());
            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => result.current.setRange({ start: '2026-07-01', end: '2026-07-31' }));
            await waitFor(() => expect(result.current.rangeActive).toBe(true));

            act(() => result.current.exportExcel());
            await waitFor(() => expect(mocks.downloadAuditLogsExcel).toHaveBeenCalled());
            expect(mocks.downloadAuditLogsExcel.mock.calls[0][2]).toBe('접속기록_2026-07-01_2026-07-31');
        });

        it('내보낼 기록이 없으면 파일을 만들지 않고 알린다', async () => {
            mocks.getAuditLogsForExport.mockResolvedValue({ logs: [], truncated: false });
            const { result } = renderHook(() => useAuditLogs());
            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => result.current.exportExcel());
            await waitFor(() => expect(result.current.error).toContain('내보낼 기록이 없습니다'));
            expect(mocks.downloadAuditLogsExcel).not.toHaveBeenCalled();
        });

        it('상한에 걸려 잘리면 그 사실을 알린다', async () => {
            mocks.getAuditLogsForExport.mockResolvedValue({ logs: page(['a1']).logs, truncated: true });
            const { result } = renderHook(() => useAuditLogs());
            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => result.current.exportExcel());
            await waitFor(() => expect(result.current.error).toContain('5,000건만'));
        });

        it('내보내기 실패는 화면 문구로 알리고 Sentry에 보고한다', async () => {
            mocks.getAuditLogsForExport.mockRejectedValue(new Error('permission-denied'));
            const { result } = renderHook(() => useAuditLogs());
            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => result.current.exportExcel());
            await waitFor(() => expect(result.current.error).toContain('내보내기에 실패'));
            expect(mocks.captureError).toHaveBeenCalled();
        });
    });

    it('조회 실패는 빈 목록이 아니라 오류 문구로 알린다', async () => {
        mocks.getAuditLogs.mockRejectedValue(new Error('permission-denied'));
        const { result } = renderHook(() => useAuditLogs());

        await waitFor(() => expect(result.current.error).toContain('불러오지 못했습니다'));
        expect(result.current.logs).toEqual([]);
        expect(result.current.hasMore).toBe(false);
    });

    describe('예약 내용', () => {
        it('예약 기록의 원본을 한 번에 읽고, 없는 것은 null(삭제됨)로 둔다', async () => {
            mocks.getAuditLogs.mockResolvedValue({
                logs: [
                    { id: 'a', action: 'create', targetType: 'reservation', targetId: 'r-1', subjectUids: [] },
                    { id: 'b', action: 'update', targetType: 'reservation', targetId: 'r-1', subjectUids: [] },
                    { id: 'c', action: 'delete', targetType: 'reservation', targetId: 'r-gone', subjectUids: [] },
                ],
                lastDoc: null,
                hasMore: false,
            });
            mocks.getReservationsByIds.mockResolvedValue(new Map([['r-1', { id: 'r-1', destination: '서울역' }]]));
            const { result } = renderHook(() => useAuditLogs());

            await waitFor(() => expect(result.current.reservationOf('r-1')).toEqual({ id: 'r-1', destination: '서울역' }));
            expect(result.current.reservationOf('r-gone')).toBeNull();
            expect(mocks.getReservationsByIds).toHaveBeenCalledTimes(1);
            expect(mocks.getReservationsByIds).toHaveBeenCalledWith('org-1', ['r-1', 'r-gone']);
            // 운행일지 조회와 섞이지 않는다
            expect(mocks.getDriveLogsByIds).not.toHaveBeenCalled();
        });
    });

    describe('운행 내용', () => {
        const driveLogPage = (targetIds: string[], hasMore = false) => ({
            logs: targetIds.map((targetId, i) => ({ id: `d${i}-${targetId}`, action: 'create', targetType: 'driveLog', targetId, subjectUids: [] })),
            lastDoc: { id: 'cursor' },
            hasMore,
        });

        it('운행일지 기록의 원본을 한 번에 읽고, 없는 것은 null(삭제됨)로 둔다', async () => {
            mocks.getAuditLogs.mockResolvedValue({
                ...driveLogPage(['dl-1', 'dl-1', 'dl-gone']),
                logs: [...driveLogPage(['dl-1', 'dl-1', 'dl-gone']).logs, ...page(['s1']).logs],
            });
            mocks.getDriveLogsByIds.mockResolvedValue(new Map([['dl-1', { id: 'dl-1', destination: '시청' }]]));
            const { result } = renderHook(() => useAuditLogs());

            await waitFor(() => expect(result.current.driveLogOf('dl-1')).toEqual({ id: 'dl-1', destination: '시청' }));
            expect(result.current.driveLogOf('dl-gone')).toBeNull();
            // 세션 기록은 대상이 아니고, 같은 ID는 한 번만 묻는다
            expect(mocks.getDriveLogsByIds).toHaveBeenCalledTimes(1);
            expect(mocks.getDriveLogsByIds).toHaveBeenCalledWith('org-1', ['dl-1', 'dl-gone']);
        });

        it('더 보기로 붙은 기록은 아직 읽지 않은 ID만 묻는다', async () => {
            mocks.getAuditLogs
                .mockResolvedValueOnce(driveLogPage(['dl-1'], true))
                .mockResolvedValueOnce(driveLogPage(['dl-1', 'dl-2']));
            const { result } = renderHook(() => useAuditLogs());
            await waitFor(() => expect(mocks.getDriveLogsByIds).toHaveBeenCalledTimes(1));

            act(() => result.current.loadMore());

            await waitFor(() => expect(mocks.getDriveLogsByIds).toHaveBeenCalledTimes(2));
            expect(mocks.getDriveLogsByIds).toHaveBeenLastCalledWith('org-1', ['dl-2']);
        });

        it('원본을 못 읽어도 기록은 보여주고 운행 내용만 비워 둔다', async () => {
            mocks.getAuditLogs.mockResolvedValue(driveLogPage(['dl-1']));
            mocks.getDriveLogsByIds.mockRejectedValue(new Error('offline'));
            const { result } = renderHook(() => useAuditLogs());

            await waitFor(() => expect(mocks.getDriveLogsByIds).toHaveBeenCalled());
            expect(result.current.logs).toHaveLength(1);
            expect(result.current.driveLogOf('dl-1')).toBeUndefined();
        });
    });
});
