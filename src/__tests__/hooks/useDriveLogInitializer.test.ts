/**
 * useDriveLogInitializer — 운행일지 폼의 초기화 side-effect
 *
 * 폼이 열릴 때 무엇이 자동으로 채워지는지를 고정한다. 여기서 잘못 채워지면 사용자는
 * 자기가 입력하지 않은 값을 그대로 저장하게 되므로, 조용히 틀리는 것이 가장 위험한 자리다.
 *  - 조직원 후보: 본인·비활성 계정 제외
 *  - 수정 모드: 동승자·공동 운전자 복원(조직원 매칭 실패분은 외부 인원으로)
 *  - 예약에서 진입: 차량·목적·목적지·동승자(예정)를 초안으로 옮긴다
 *  - 이미 완료된 예약으로 들어오면 되돌려 보낸다(중복 작성 차단)
 *  - 차량이 하나뿐이면 자동 선택
 *  - 소급 입력(과거 날짜)이면 그 날짜 기준 직전·직후 기록을 함께 읽는다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));

const mockGetVehicles = vi.fn();
const mockGetFavorites = vi.fn();
const mockGetOrganizationMembers = vi.fn();
const mockGetLastVehicleEndKm = vi.fn();
const mockGetLastVehicleEndBattery = vi.fn();
const mockGetReservationById = vi.fn();
const mockGetHipassCards = vi.fn();
const mockGetLastVehicleDriveLog = vi.fn();
const mockGetAdjacentDriveLogs = vi.fn();

vi.mock('../../lib/firestore', () => ({
    getVehicles: (...a: unknown[]) => mockGetVehicles(...a),
    getFavorites: (...a: unknown[]) => mockGetFavorites(...a),
    getOrganizationMembers: (...a: unknown[]) => mockGetOrganizationMembers(...a),
    getLastVehicleEndKm: (...a: unknown[]) => mockGetLastVehicleEndKm(...a),
    getLastVehicleEndBattery: (...a: unknown[]) => mockGetLastVehicleEndBattery(...a),
    getReservationById: (...a: unknown[]) => mockGetReservationById(...a),
    getHipassCards: (...a: unknown[]) => mockGetHipassCards(...a),
    getLastVehicleDriveLog: (...a: unknown[]) => mockGetLastVehicleDriveLog(...a),
    getAdjacentDriveLogs: (...a: unknown[]) => mockGetAdjacentDriveLogs(...a),
}));

const mockResolveStartKm = vi.fn(async () => '51000');
vi.mock('../../hooks/driveLogForm/resolveStartKm', () => ({
    resolveStartKm: (...a: unknown[]) => mockResolveStartKm(...(a as [])),
}));
vi.mock('../../lib/sentry', () => ({ captureError: vi.fn() }));

import { useDriveLogInitializer, type InitializerDeps } from '../../hooks/driveLogForm/useDriveLogInitializer';
import { todayStr } from '../../hooks/utils/driveLogValidation';
import type { DriveLog } from '../../types/driveLog';
import type { User as UserDoc } from '../../types/user';

const setters = {
    setVehicles: vi.fn(),
    setFavorites: vi.fn(),
    setMembers: vi.fn(),
    setLoading: vi.fn(),
    setForm: vi.fn(),
    setSelectedPassengers: vi.fn(),
    setExternalPassengerCount: vi.fn(),
    setExternalPassengerNames: vi.fn(),
    setSelectedCoDrivers: vi.fn(),
    setExternalCoDriverNames: vi.fn(),
    setResolvedReservationData: vi.fn(),
    setLastEndBattery: vi.fn(),
    setHipassCard: vi.fn(),
    setLastDriveLog: vi.fn(),
    setNextDriveLog: vi.fn(),
};
const showToast = vi.fn();

function deps(over: Partial<InitializerDeps> = {}): InitializerDeps {
    return {
        orgId: 'org1',
        user: { uid: 'me' } as InitializerDeps['user'],
        isEditMode: false,
        editLog: null,
        reservationData: null,
        queryReservationId: null,
        resolvedReservationData: null,
        isElectric: false,
        form: { vehicleId: '', driveDate: todayStr(), startTime: '09:00' },
        showToast,
        vehicles: [],
        members: [],
        ...setters,
        ...over,
    };
}

/** setForm에 넘어간 업데이터들을 순서대로 적용한 결과 */
function appliedForm() {
    return setters.setForm.mock.calls.reduce((acc: Record<string, unknown>, [updater]) => (
        typeof updater === 'function' ? { ...acc, ...updater(acc) } : { ...acc, ...updater }
    ), {} as Record<string, unknown>);
}

beforeEach(() => {
    vi.clearAllMocks();
    mockGetVehicles.mockResolvedValue([]);
    mockGetFavorites.mockResolvedValue([]);
    mockGetOrganizationMembers.mockResolvedValue([]);
    mockGetHipassCards.mockResolvedValue([]);
    mockGetLastVehicleDriveLog.mockResolvedValue(null);
    mockGetAdjacentDriveLogs.mockResolvedValue({ prev: null, next: null });
    mockGetLastVehicleEndKm.mockResolvedValue(null);
    mockGetLastVehicleEndBattery.mockResolvedValue(null);
    mockResolveStartKm.mockResolvedValue('51000');
});

describe('초기 로드', () => {
    it('기관 정보가 없으면 아무 것도 읽지 않는다', () => {
        renderHook(() => useDriveLogInitializer(deps({ orgId: null })));
        expect(mockGetVehicles).not.toHaveBeenCalled();
    });

    it('조직원 후보에서 본인과 비활성 계정을 뺀다', async () => {
        mockGetOrganizationMembers.mockResolvedValue([
            { id: 'me', name: '나' },
            { id: 'other', name: '동료' },
            { id: 'gone', name: '퇴사자', status: 'disabled' },
        ]);
        renderHook(() => useDriveLogInitializer(deps()));

        await waitFor(() => expect(setters.setMembers).toHaveBeenCalled());
        expect(setters.setMembers.mock.calls[0][0]).toEqual([{ id: 'other', name: '동료' }]);
    });

    it('차량이 하나뿐이면 자동으로 고른다', async () => {
        mockGetVehicles.mockResolvedValue([{ id: 'v1', name: '카니발', displayName: '카니발' }]);
        renderHook(() => useDriveLogInitializer(deps()));

        await waitFor(() => expect(setters.setForm).toHaveBeenCalled());
        expect(appliedForm()).toMatchObject({ vehicleId: 'v1', vehicleName: '카니발', startKm: '51000' });
    });

    it('차량이 여럿이면 자동으로 고르지 않는다', async () => {
        mockGetVehicles.mockResolvedValue([{ id: 'v1' }, { id: 'v2' }]);
        renderHook(() => useDriveLogInitializer(deps()));

        await waitFor(() => expect(setters.setLoading).toHaveBeenCalledWith(false));
        expect(setters.setForm).not.toHaveBeenCalled();
    });

    it('읽기에 실패해도 로딩은 반드시 끝낸다 — 스켈레톤에 갇히지 않게', async () => {
        mockGetVehicles.mockRejectedValue(new Error('boom'));
        renderHook(() => useDriveLogInitializer(deps()));

        await waitFor(() => expect(setters.setLoading).toHaveBeenCalledWith(false));
    });
});

describe('수정 모드 복원', () => {
    const members: UserDoc[] = [
        { id: 'a', name: '김철수' } as UserDoc,
        { id: 'b', name: '이영희' } as UserDoc,
    ];

    it('동승자 이름을 조직원과 맞추고, 못 맞춘 이름은 외부 인원 수로 센다', async () => {
        mockGetOrganizationMembers.mockResolvedValue(members);
        renderHook(() => useDriveLogInitializer(deps({
            isEditMode: true,
            editLog: { id: 'e1', passengerNames: ['김철수', '외부손님'] } as DriveLog & { passengerNames?: string[] },
        })));

        await waitFor(() => expect(setters.setSelectedPassengers).toHaveBeenCalled());
        expect(setters.setSelectedPassengers.mock.calls[0][0]).toEqual([members[0]]);
        expect(setters.setExternalPassengerCount).toHaveBeenCalledWith(1);
    });

    it('공동 운전자는 uid를 우선으로 맞추고 남은 이름은 직접 입력란에 되돌린다', async () => {
        mockGetOrganizationMembers.mockResolvedValue(members);
        renderHook(() => useDriveLogInitializer(deps({
            isEditMode: true,
            editLog: { id: 'e1', coDriverUids: ['b'], coDriverNames: ['이영희', '외부기사'] } as DriveLog,
        })));

        await waitFor(() => expect(setters.setSelectedCoDrivers).toHaveBeenCalled());
        expect(setters.setSelectedCoDrivers.mock.calls[0][0]).toEqual([members[1]]);
        expect(setters.setExternalCoDriverNames).toHaveBeenCalledWith('외부기사');
    });

    it('수정 대상의 앞뒤 기록을 함께 읽어 온다 — km 범위 검증에 쓰인다', async () => {
        const editLog = { id: 'e1', vehicleId: 'v1' } as DriveLog;
        mockGetAdjacentDriveLogs.mockResolvedValue({ prev: { id: 'p' }, next: { id: 'n' } });
        renderHook(() => useDriveLogInitializer(deps({ isEditMode: true, editLog })));

        await waitFor(() => expect(mockGetAdjacentDriveLogs).toHaveBeenCalledWith('org1', 'v1', editLog));
        expect(setters.setLastDriveLog).toHaveBeenCalledWith({ id: 'p' });
        expect(setters.setNextDriveLog).toHaveBeenCalledWith({ id: 'n' });
    });

    it('수정 모드에서는 차량 변경 effect가 출발 km를 덮어쓰지 않는다', async () => {
        renderHook(() => useDriveLogInitializer(deps({
            isEditMode: true,
            editLog: { id: 'e1', vehicleId: 'v1' } as DriveLog,
            form: { vehicleId: 'v1', driveDate: todayStr(), startTime: '09:00' },
        })));

        await waitFor(() => expect(mockGetAdjacentDriveLogs).toHaveBeenCalled());
        expect(mockResolveStartKm).not.toHaveBeenCalled();
    });
});

describe('예약에서 넘어온 경우', () => {
    it('차량·목적·목적지를 초안으로 옮긴다', async () => {
        mockGetVehicles.mockResolvedValue([{ id: 'v1', displayName: '카니발' }]);
        renderHook(() => useDriveLogInitializer(deps({
            reservationData: { vehicleId: 'v1', purpose: '출장', destination: '시청' },
        })));

        await waitFor(() => expect(setters.setForm).toHaveBeenCalled());
        expect(appliedForm()).toMatchObject({
            vehicleId: 'v1', vehicleName: '카니발', purpose: '출장', destination: '시청',
        });
    });

    it('예약에 적어 둔 동승자를 초안으로 채운다', async () => {
        mockGetVehicles.mockResolvedValue([{ id: 'v1' }]);
        mockGetOrganizationMembers.mockResolvedValue([{ id: 'a', name: '김철수' }]);
        renderHook(() => useDriveLogInitializer(deps({
            reservationData: { vehicleId: 'v1', passengerUids: ['a'], passengerCount: 2 },
        })));

        await waitFor(() => expect(setters.setSelectedPassengers).toHaveBeenCalled());
        expect(setters.setExternalPassengerCount).toHaveBeenCalledWith(2);
    });
});

describe('알림에서 예약 id로 들어온 경우', () => {
    it('이미 완료된 예약이면 안내하고 오늘의 운행으로 돌려보낸다 — 중복 작성 차단', async () => {
        mockGetReservationById.mockResolvedValue({ id: 'r1', status: 'completed' });
        renderHook(() => useDriveLogInitializer(deps({ queryReservationId: 'r1' })));

        await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/employee/today', { replace: true }));
        expect(showToast).toHaveBeenCalledWith('이미 운행일지 작성이 완료된 건입니다.', 'info');
        expect(setters.setResolvedReservationData).not.toHaveBeenCalled();
    });

    it('진행 중인 예약이면 폼에 반영하고 실제 출발 시각을 채운다', async () => {
        mockGetReservationById.mockResolvedValue({
            id: 'r1', status: 'in_progress', vehicleId: 'v1', vehicleName: '카니발',
            purpose: '출장', destination: '시청', actualStartTime: '10:30', currentKm: 51234,
        });
        renderHook(() => useDriveLogInitializer(deps({ queryReservationId: 'r1' })));

        await waitFor(() => expect(setters.setResolvedReservationData).toHaveBeenCalled());
        expect(appliedForm()).toMatchObject({
            vehicleId: 'v1', vehicleName: '카니발', startTime: '10:30', startKm: '51234',
        });
    });

    /**
     * ⚠️ 현행 동작을 그대로 고정한다.
     * `currentKm: res.currentKm || 0`으로 0을 채워 넣은 뒤 `data.currentKm ?? lastEndKm`로
     * 폴백하므로, **마지막 기록의 도착 km로 넘어가는 가지는 절대 실행되지 않는다**(0은 nullish가 아니다).
     * 화면에는 영향이 없다 — 차량이 정해지는 순간 Effect 3의 `resolveStartKm`이 값을 다시 계산해
     * 덮어쓴다. 즉 죽은 폴백이지 사용자에게 보이는 결함은 아니다. 정리한다면 이 테스트도 함께 바꾼다.
     */
    it('예약에 현재 km가 없으면 0으로 채운다 (마지막 도착 km 폴백은 도달하지 않는 가지다)', async () => {
        mockGetReservationById.mockResolvedValue({ id: 'r1', status: 'reserved', vehicleId: 'v1' });
        mockGetLastVehicleEndKm.mockResolvedValue(48000);
        renderHook(() => useDriveLogInitializer(deps({ queryReservationId: 'r1' })));

        await waitFor(() => expect(setters.setLastDriveLog).toHaveBeenCalled());
        expect(appliedForm()).toMatchObject({ startKm: '0' });
    });

    it('이미 해석된 예약이 있으면 다시 읽지 않는다', () => {
        renderHook(() => useDriveLogInitializer(deps({
            queryReservationId: 'r1',
            resolvedReservationData: { reservationId: 'r1' },
        })));
        expect(mockGetReservationById).not.toHaveBeenCalled();
    });
});

describe('차량·날짜 변경', () => {
    it('오늘 작성이면 최신 기록만 읽는다', async () => {
        renderHook(() => useDriveLogInitializer(deps({
            form: { vehicleId: 'v1', driveDate: todayStr(), startTime: '09:00' },
        })));

        await waitFor(() => expect(mockGetLastVehicleDriveLog).toHaveBeenCalledWith('org1', 'v1'));
        expect(setters.setNextDriveLog).toHaveBeenCalledWith(null);
    });

    it('과거 날짜(소급 입력)면 그 날짜 기준 앞뒤 기록을 함께 읽는다', async () => {
        renderHook(() => useDriveLogInitializer(deps({
            form: { vehicleId: 'v1', driveDate: '2020-01-15', startTime: '09:00' },
        })));

        await waitFor(() => expect(mockGetAdjacentDriveLogs).toHaveBeenCalled());
        const anchor = mockGetAdjacentDriveLogs.mock.calls[0][2] as DriveLog;
        expect((anchor.timestamp as Date).getFullYear()).toBe(2020);
    });

    it('차량이 선택되지 않았으면 앞뒤 기록을 비운다', async () => {
        renderHook(() => useDriveLogInitializer(deps({
            form: { vehicleId: '', driveDate: todayStr(), startTime: '09:00' },
        })));

        await waitFor(() => expect(setters.setLastDriveLog).toHaveBeenCalledWith(null));
        expect(setters.setNextDriveLog).toHaveBeenCalledWith(null);
    });
});

describe('전기차 배터리 / 하이패스 카드', () => {
    it('전기차가 아니면 도착 배터리를 조회하지 않는다', async () => {
        renderHook(() => useDriveLogInitializer(deps({
            isElectric: false, form: { vehicleId: 'v1', driveDate: todayStr(), startTime: '09:00' },
        })));

        await waitFor(() => expect(setters.setLastEndBattery).toHaveBeenCalledWith(null));
        expect(mockGetLastVehicleEndBattery).not.toHaveBeenCalled();
    });

    it('전기차면 마지막 도착 배터리를 채운다', async () => {
        mockGetLastVehicleEndBattery.mockResolvedValue(72);
        renderHook(() => useDriveLogInitializer(deps({
            isElectric: true, form: { vehicleId: 'v1', driveDate: todayStr(), startTime: '09:00' },
        })));

        await waitFor(() => expect(setters.setLastEndBattery).toHaveBeenCalledWith(72));
    });

    it('배터리 조회가 실패해도 화면을 깨지 않는다', async () => {
        mockGetLastVehicleEndBattery.mockRejectedValue(new Error('boom'));
        renderHook(() => useDriveLogInitializer(deps({
            isElectric: true, form: { vehicleId: 'v1', driveDate: todayStr(), startTime: '09:00' },
        })));

        await waitFor(() => expect(setters.setLastEndBattery).toHaveBeenCalledWith(null));
    });

    it('차량에 연결된 하이패스 카드만 고른다', async () => {
        mockGetHipassCards.mockResolvedValue([
            { id: 'c1', vehicleId: 'other' },
            { id: 'c2', vehicleId: 'v1' },
        ]);
        renderHook(() => useDriveLogInitializer(deps({
            form: { vehicleId: 'v1', driveDate: todayStr(), startTime: '09:00' },
        })));

        await waitFor(() => expect(setters.setHipassCard).toHaveBeenCalledWith({ id: 'c2', vehicleId: 'v1' }));
    });

    it('연결된 카드가 없으면 비운다', async () => {
        mockGetHipassCards.mockResolvedValue([{ id: 'c1', vehicleId: 'other' }]);
        renderHook(() => useDriveLogInitializer(deps({
            form: { vehicleId: 'v1', driveDate: todayStr(), startTime: '09:00' },
        })));

        await waitFor(() => expect(setters.setHipassCard).toHaveBeenCalledWith(null));
    });

    it('카드 조회가 실패해도 화면을 깨지 않는다', async () => {
        mockGetHipassCards.mockRejectedValue(new Error('boom'));
        renderHook(() => useDriveLogInitializer(deps({
            form: { vehicleId: 'v1', driveDate: todayStr(), startTime: '09:00' },
        })));

        await waitFor(() => expect(setters.setHipassCard).toHaveBeenCalledWith(null));
    });
});
