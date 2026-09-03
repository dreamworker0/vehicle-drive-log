/**
 * calendarFailTracking.test.ts — 캘린더 동기화 실패 백오프 공통 모듈 테스트
 *
 * shouldSkipVehicleCalendar(쿨다운/영구제외 판단)와 recordCalendarFailure(카운터 캡)를 검증한다.
 */

// ── Firestore mock ──
const mockUpdate = jest.fn();
const mockVehicleGet = jest.fn();
const mockOrgGet = jest.fn();
const mockUsersGet = jest.fn();
/** users 쿼리에 걸린 where 절 — 관리자만 대상으로 삼는지 검증용 */
const mockUsersWhere = jest.fn();

/** 같은 기관의 다른 차량들 (기관 단위 중복 억제 검증용) */
const mockSiblingsGet = jest.fn();
/** 트랜잭션 안에서 일어난 쓰기 */
const mockTxUpdate = jest.fn();

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: (name: string) => {
            if (name === 'organizations') {
                return { doc: () => ({ get: mockOrgGet }) };
            }
            if (name === 'users') {
                const chain: Record<string, unknown> = {
                    where: (...args: unknown[]) => { mockUsersWhere(...args); return chain; },
                    get: () => mockUsersGet(),
                };
                return chain;
            }
            // vehicles — doc 단건과 기관 형제 조회 둘 다 받는다
            const vehicles: Record<string, unknown> = {
                doc: () => ({ update: mockUpdate, get: mockVehicleGet }),
                where: () => vehicles,
                get: () => mockSiblingsGet(),
            };
            return vehicles;
        },
        runTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
            fn({ get: () => mockVehicleGet(), update: (...a: unknown[]) => mockTxUpdate(...a) }),
    }),
    FieldValue: {
        serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
        delete: jest.fn(() => 'DELETE'),
    },
}));

// 알림 모듈은 messaging까지 끌고 오므로 동적 import를 가로챈다
const mockCreateInAppNotification = jest.fn();
jest.mock('../services/alimtalk/sendNotification', () => ({
    createInAppNotification: (...args: unknown[]) => mockCreateInAppNotification(...args),
}));

import {
    shouldSkipVehicleCalendar,
    recordCalendarFailure,
    resetCalendarFailure,
    isCalendarAuthError,
    calendarErrorStatus,
    calendarFailReason,
    MAX_FAIL_COUNT,
    RETRY_COOLDOWN_MS,
} from '../services/calendar/calendarFailTracking';

/** 영구 중단 통지 경로가 정상적으로 흐르도록 하는 기본 mock 상태 */
function givenNotifiableVehicle(overrides: Record<string, unknown> = {}) {
    mockVehicleGet.mockResolvedValue({
        exists: true,
        data: () => ({
            organizationId: 'org1',
            displayName: '모닝',
            calendarSyncLastFailReason: 'not_found',
            ...overrides,
        }),
    });
    mockOrgGet.mockResolvedValue({ exists: true, data: () => ({ name: '테스트기관' }) });
    mockUsersGet.mockResolvedValue({
        empty: false,
        docs: [
            { id: 'admin1', data: () => ({ status: 'active' }) },
            { id: 'admin2', data: () => ({}) },
        ],
    });
    // 기관에 이 차량뿐 — 중복 억제에 걸리지 않는 상태
    mockSiblingsGet.mockResolvedValue({ docs: [] });
}

describe('calendarFailTracking', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    describe('shouldSkipVehicleCalendar()', () => {
        it('failCount < 3 이면 건너뛰지 않음', () => {
            expect(shouldSkipVehicleCalendar({ calendarSyncFailCount: 0 })).toBe(false);
            expect(shouldSkipVehicleCalendar({ calendarSyncFailCount: 2 })).toBe(false);
        });

        it('failCount >= MAX_FAIL_COUNT(영구제외)면 항상 건너뜀', () => {
            expect(shouldSkipVehicleCalendar({ calendarSyncFailCount: MAX_FAIL_COUNT })).toBe(true);
            expect(shouldSkipVehicleCalendar({ calendarSyncFailCount: 192 })).toBe(true);
        });

        it('failCount 3~9 + 마지막 실패가 24h 이내면 쿨다운으로 건너뜀', () => {
            const recent = new Date(Date.now() - 60 * 60 * 1000); // 1시간 전
            expect(shouldSkipVehicleCalendar({ calendarSyncFailCount: 5, calendarSyncLastFailAt: recent })).toBe(true);
        });

        it('failCount 3~9 + 마지막 실패가 24h 초과면 재시도 허용(건너뛰지 않음)', () => {
            const old = new Date(Date.now() - RETRY_COOLDOWN_MS - 60 * 1000); // 24h + 1분 전
            expect(shouldSkipVehicleCalendar({ calendarSyncFailCount: 5, calendarSyncLastFailAt: old })).toBe(false);
        });
    });

    describe('recordCalendarFailure() — 카운터 캡', () => {
        it('일반 증가: currentFailCount + 1', async () => {
            const next = await recordCalendarFailure('v1', 2);
            expect(next).toBe(3);
            expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ calendarSyncFailCount: 3 }));
        });

        it('MAX 도달 시 더 증가하지 않고 MAX로 캡', async () => {
            const next = await recordCalendarFailure('v1', MAX_FAIL_COUNT);
            expect(next).toBe(MAX_FAIL_COUNT);
            expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ calendarSyncFailCount: MAX_FAIL_COUNT }));
        });

        it('이미 MAX를 초과한 오염된 값(예: 191)도 MAX로 수렴', async () => {
            const next = await recordCalendarFailure('v1', 191);
            expect(next).toBe(MAX_FAIL_COUNT);
        });
    });

    describe('isCalendarAuthError() — 설정 오류 판별', () => {
        it('메시지가 "Forbidden"이면 설정 오류로 본다 (숫자 없는 사유 문구)', () => {
            // 실제 Sentry에 잡힌 형태. 숫자 403이 없어 예전 문자열 검사로는 놓쳤고,
            // 그래서 백오프가 발동하지 않아 같은 차량이 매 예약 변경마다 알림을 쌓았다.
            expect(isCalendarAuthError(new Error('Forbidden'))).toBe(true);
        });

        it('상태 코드로도 판별한다 (code / status / response.status)', () => {
            expect(isCalendarAuthError({ code: 403, message: '' })).toBe(true);
            expect(isCalendarAuthError({ code: 404, message: '' })).toBe(true);
            expect(isCalendarAuthError({ status: 403, message: '' })).toBe(true);
            expect(isCalendarAuthError({ response: { status: 404 }, message: '' })).toBe(true);
        });

        it('문자열 상태 코드도 인식한다', () => {
            expect(isCalendarAuthError({ code: '403', message: 'Request failed' })).toBe(true);
        });

        it('기존 메시지 형태(Not Found·404·403)는 그대로 인식한다', () => {
            expect(isCalendarAuthError(new Error('Not Found'))).toBe(true);
            expect(isCalendarAuthError(new Error('Request failed with status code 404'))).toBe(true);
            expect(isCalendarAuthError(new Error('403 insufficient permissions'))).toBe(true);
        });

        it('설정 오류가 아닌 실패는 false — 진짜 장애는 Sentry로 올라가야 한다', () => {
            expect(isCalendarAuthError(new Error('Internal Server Error'))).toBe(false);
            expect(isCalendarAuthError({ code: 500, message: 'Backend Error' })).toBe(false);
            expect(isCalendarAuthError({ code: 'ETIMEDOUT', message: 'socket hang up' })).toBe(false);
            expect(isCalendarAuthError(new Error('quota exceeded'))).toBe(false);
        });

        it('null·undefined에도 안전하다', () => {
            expect(isCalendarAuthError(null)).toBe(false);
            expect(isCalendarAuthError(undefined)).toBe(false);
        });
    });

    describe('calendarErrorStatus() — 판정 근거 단일 원본', () => {
        it('isCalendarAuthError와 같은 오류를 같은 상태로 읽는다', () => {
            // 숫자 없이 사유 문구만 오는 형태까지 흡수해야 진단 도구와 운영 경로의 판정이 갈리지 않는다
            expect(calendarErrorStatus(new Error('Forbidden'))).toBe(403);
            expect(calendarErrorStatus(new Error('Not Found'))).toBe(404);
            expect(calendarErrorStatus({ response: { status: 404 }, message: '' })).toBe(404);
            expect(calendarErrorStatus({ code: '403', message: 'Request failed' })).toBe(403);
        });

        it('설정 오류가 아닌 상태 코드는 그대로 돌려주고, 판별 불가는 null이다', () => {
            expect(calendarErrorStatus({ code: 500, message: 'Backend Error' })).toBe(500);
            expect(calendarErrorStatus({ code: 'ETIMEDOUT', message: 'socket hang up' })).toBeNull();
            expect(calendarErrorStatus(null)).toBeNull();
        });

        it('상태 코드를 사유 코드로 좁힌다', () => {
            expect(calendarFailReason(404)).toBe('not_found');
            expect(calendarFailReason(403)).toBe('forbidden');
            expect(calendarFailReason(500)).toBe('other');
            expect(calendarFailReason(null)).toBe('other');
        });
    });

    describe('recordCalendarFailure() — 실패 사유 기록', () => {
        it('오류를 넘기면 상태 코드와 사유를 함께 남긴다', async () => {
            await recordCalendarFailure('v1', 1, { code: 403, message: 'Forbidden' });
            expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
                calendarSyncLastFailStatus: 403,
                calendarSyncLastFailReason: 'forbidden',
            }));
        });

        it('오류를 넘기지 않으면 사유를 건드리지 않는다 (지난 진단 근거를 지우지 않는다)', async () => {
            await recordCalendarFailure('v1', 1);
            const payload = mockUpdate.mock.calls[0][0];
            expect(payload).not.toHaveProperty('calendarSyncLastFailReason');
            expect(payload).not.toHaveProperty('calendarSyncLastFailStatus');
        });

        it('상태를 판별하지 못하면 사유만 other로 남기고 상태 코드는 쓰지 않는다', async () => {
            await recordCalendarFailure('v1', 1, new Error('socket hang up'));
            const payload = mockUpdate.mock.calls[0][0];
            expect(payload.calendarSyncLastFailReason).toBe('other');
            expect(payload).not.toHaveProperty('calendarSyncLastFailStatus');
        });
    });

    describe('recordCalendarFailure() — 영구 중단 기관 통지', () => {
        it('영구 중단으로 넘어가는 순간 기관 관리자에게만 알린다', async () => {
            givenNotifiableVehicle();

            await recordCalendarFailure('v1', MAX_FAIL_COUNT - 1, { code: 404, message: 'Not Found' });

            expect(mockCreateInAppNotification).toHaveBeenCalledTimes(2);
            // 복구는 관리자 전용 화면에서만 가능하다 — 전 직원에게 보내면 고칠 수 없는 사람에게 알림만 쌓인다
            expect(mockUsersWhere).toHaveBeenCalledWith('role', '==', 'admin');
            expect(mockUsersWhere).toHaveBeenCalledWith('organizationId', '==', 'org1');
            const message = mockCreateInAppNotification.mock.calls[0][3] as string;
            expect(message).toContain('모닝');
            expect(message).toContain('캘린더가 삭제되었거나');
        });

        it('발송 자리를 트랜잭션으로 선점한다 (검사와 쓰기가 갈라지지 않는다)', async () => {
            givenNotifiableVehicle();
            await recordCalendarFailure('v1', MAX_FAIL_COUNT - 1, { code: 404, message: 'Not Found' });
            // 표식은 트랜잭션 안에서 찍힌다 — 밖에서 찍으면 동시 진입이 함께 통과한다
            expect(mockTxUpdate).toHaveBeenCalledWith(
                expect.anything(),
                { calendarSyncDisabledNotifiedAt: 'SERVER_TIMESTAMP' },
            );
        });

        it('동시에 두 번 들어와도 한 번만 보낸다 (선점 경합)', async () => {
            givenNotifiableVehicle();
            // 두 번째 트랜잭션이 읽을 때는 이미 표식이 찍혀 있다
            let claimed = false;
            mockVehicleGet.mockImplementation(async () => {
                const data = {
                    organizationId: 'org1',
                    displayName: '모닝',
                    calendarSyncLastFailReason: 'not_found',
                    ...(claimed ? { calendarSyncDisabledNotifiedAt: 'SERVER_TIMESTAMP' } : {}),
                };
                claimed = true;
                return { exists: true, data: () => data };
            });

            await Promise.all([
                recordCalendarFailure('v1', MAX_FAIL_COUNT - 1, { code: 404, message: 'Not Found' }),
                recordCalendarFailure('v1', MAX_FAIL_COUNT - 1, { code: 404, message: 'Not Found' }),
            ]);

            expect(mockCreateInAppNotification).toHaveBeenCalledTimes(2); // 관리자 2명 × 1회
        });

        it('임계 아래에서는 알리지 않는다', async () => {
            givenNotifiableVehicle();
            await recordCalendarFailure('v1', MAX_FAIL_COUNT - 2, { code: 404, message: 'Not Found' });
            expect(mockCreateInAppNotification).not.toHaveBeenCalled();
        });

        it('이미 영구 중단이던 차량은 다시 알리지 않는다', async () => {
            givenNotifiableVehicle();
            await recordCalendarFailure('v1', MAX_FAIL_COUNT, { code: 404, message: 'Not Found' });
            expect(mockCreateInAppNotification).not.toHaveBeenCalled();
        });

        it('표식이 이미 있으면 선점에 실패해 보내지 않는다', async () => {
            givenNotifiableVehicle({ calendarSyncDisabledNotifiedAt: 'SERVER_TIMESTAMP' });
            await recordCalendarFailure('v1', MAX_FAIL_COUNT - 1, { code: 404, message: 'Not Found' });
            expect(mockCreateInAppNotification).not.toHaveBeenCalled();
            expect(mockTxUpdate).not.toHaveBeenCalled();
        });

        it('같은 기관에 최근 보냈으면 억제한다 — 기관 전체가 한꺼번에 끊겨도 도배하지 않는다', async () => {
            // 이 앱은 기관 내 모든 차량이 같은 캘린더를 쓰도록 안내한다. 그 캘린더가 지워지면
            // 차량 전부가 한 실행에서 나란히 임계를 넘어 알림이 차량 수 × 관리자 수만큼 쌓인다.
            givenNotifiableVehicle();
            mockSiblingsGet.mockResolvedValue({
                docs: [{ id: 'v2', data: () => ({ calendarSyncDisabledNotifiedAt: new Date() }) }],
            });

            await recordCalendarFailure('v1', MAX_FAIL_COUNT - 1, { code: 404, message: 'Not Found' });

            expect(mockCreateInAppNotification).not.toHaveBeenCalled();
            // 선점은 유지한다 — 이 차량은 처리된 것이 맞고, 풀면 다음 실행에서 다시 후보가 된다
            expect(mockUpdate).not.toHaveBeenCalledWith({ calendarSyncDisabledNotifiedAt: 'DELETE' });
        });

        it('오래된 형제 알림은 억제하지 않는다 (쿨다운 경과)', async () => {
            givenNotifiableVehicle();
            const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000); // 8일 전
            mockSiblingsGet.mockResolvedValue({
                docs: [{ id: 'v2', data: () => ({ calendarSyncDisabledNotifiedAt: old }) }],
            });

            await recordCalendarFailure('v1', MAX_FAIL_COUNT - 1, { code: 404, message: 'Not Found' });
            expect(mockCreateInAppNotification).toHaveBeenCalled();
        });

        it('캘린더 기능을 끈 기관에는 알리지 않는다 (애초에 동기화가 돌지 않는다)', async () => {
            givenNotifiableVehicle();
            mockOrgGet.mockResolvedValue({ exists: true, data: () => ({ googleCalendarEnabled: false }) });
            await recordCalendarFailure('v1', MAX_FAIL_COUNT - 1, { code: 404, message: 'Not Found' });
            expect(mockCreateInAppNotification).not.toHaveBeenCalled();
        });

        it('비활성 관리자만 남은 기관은 선점을 되돌리고 운영자에게 올린다', async () => {
            // 아무도 못 읽는 알림을 만들고 표식만 태우면, 그 기관은 영영 통지 대상에서 빠진다
            givenNotifiableVehicle();
            mockUsersGet.mockResolvedValue({
                empty: false,
                docs: [{ id: 'admin1', data: () => ({ status: 'disabled' }) }],
            });

            await recordCalendarFailure('v1', MAX_FAIL_COUNT - 1, { code: 404, message: 'Not Found' });

            expect(mockCreateInAppNotification).not.toHaveBeenCalled();
            expect(mockUpdate).toHaveBeenCalledWith({ calendarSyncDisabledNotifiedAt: 'DELETE' });
        });

        it('알림 생성이 모두 실패하면 선점을 되돌린다 (자동 재시도가 없는 경로다)', async () => {
            givenNotifiableVehicle();
            mockCreateInAppNotification.mockRejectedValue(new Error('write failed'));

            await recordCalendarFailure('v1', MAX_FAIL_COUNT - 1, { code: 404, message: 'Not Found' });

            expect(mockUpdate).toHaveBeenCalledWith({ calendarSyncDisabledNotifiedAt: 'DELETE' });
        });

        it('알림이 실패해도 실패 카운트 기록은 성립한다', async () => {
            givenNotifiableVehicle();
            mockUsersGet.mockRejectedValue(new Error('users 조회 실패'));

            const next = await recordCalendarFailure('v1', MAX_FAIL_COUNT - 1, { code: 404, message: 'Not Found' });

            expect(next).toBe(MAX_FAIL_COUNT);
            expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ calendarSyncFailCount: MAX_FAIL_COUNT }));
        });
    });

    describe('resetCalendarFailure() — 사유·통지 표식도 함께 지운다', () => {
        it('카운터와 함께 사유·상태·통지 표식을 제거한다', async () => {
            await resetCalendarFailure('v1');
            expect(mockUpdate).toHaveBeenCalledWith({
                calendarSyncFailCount: 0,
                // 남겨 두면 복구된 차량에 지난 사유가 붙어 있고, 통지 표식 탓에
                // 다음에 다시 끊겼을 때 기관에 알리지 못한다
                calendarSyncLastFailReason: 'DELETE',
                calendarSyncLastFailStatus: 'DELETE',
                calendarSyncDisabledNotifiedAt: 'DELETE',
            });
        });
    });
});
