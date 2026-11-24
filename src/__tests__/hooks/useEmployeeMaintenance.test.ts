import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { MaintenanceRecord } from '../../types/maintenance';

/**
 * useEmployeeMaintenance — 직원용 정비 기록 CRUD.
 * 고정하는 계약:
 *  - 기관 ID로 조회하고, 저장 페이로드에 organizationId·작성자 uid를 싣는다
 *  - 직원은 차량 차단을 못 한다(blockVehicle은 항상 false)
 *  - 본인이 쓴 기록만 수정·삭제한다
 *  - 필수값·음수 검증에 걸리면 저장하지 않는다, 지수 표기(1e5)는 100000으로 저장한다
 */
const mockShowToast = vi.fn();
const mockConfirm = vi.fn();
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => ({ confirm: mockConfirm }) }));

// 참조가 매 렌더 바뀌지 않도록 바깥에서 한 번만 만든다
const authState: { user: { uid: string; displayName?: string } | null; userData: { organizationId?: string; name?: string } | null } = {
    user: { uid: 'emp-1', displayName: '구글이름' },
    userData: { organizationId: 'org-A', name: '김직원' },
};
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => authState }));

const mockToday = vi.hoisted(() => ({ value: '2026-11-24' }));
vi.mock('../../lib/dateUtils', () => ({ toLocalDateStr: () => mockToday.value }));

const mockGetVehicles = vi.fn();
const mockGetRecords = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
vi.mock('../../lib/firestore', () => ({
    getVehicles: (...a: unknown[]) => mockGetVehicles(...a),
    getMaintenanceRecords: (...a: unknown[]) => mockGetRecords(...a),
    createMaintenanceRecord: (...a: unknown[]) => mockCreate(...a),
    updateMaintenanceRecord: (...a: unknown[]) => mockUpdate(...a),
    deleteMaintenanceRecord: (...a: unknown[]) => mockDelete(...a),
}));

import useEmployeeMaintenance from '../../hooks/useEmployeeMaintenance';

const VEHICLES = [
    { id: 'v1', displayName: '쏘나타', vehicleType: 'sedan' },
    { id: 'v2', displayName: '스타리아', vehicleType: 'van' },
];
const MINE = {
    id: 'm1', vehicleId: 'v1', vehicleName: '쏘나타', date: '2026-11-01', type: 'repair',
    description: '타이어 교체', cost: 120000, shop: '동네카센터', km: 52000, createdByUid: 'emp-1',
} as unknown as MaintenanceRecord;
const OTHERS = {
    id: 'm2', vehicleId: 'v9', date: '2026-11-02', type: 'inspection', createdByUid: 'emp-2',
} as unknown as MaintenanceRecord;

const submitEvent = () => ({ preventDefault: vi.fn() }) as unknown as React.FormEvent;

async function renderReady() {
    const hook = renderHook(() => useEmployeeMaintenance());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    return hook;
}

/** 폼을 채운다 — handleVehicleSelect가 form 클로저를 쓰므로 한 번에 하나씩 act로 감싼다 */
async function fillForm(
    result: { current: ReturnType<typeof useEmployeeMaintenance> },
    fields: Partial<ReturnType<typeof useEmployeeMaintenance>['form']>,
) {
    act(() => { result.current.setForm(prev => ({ ...prev, ...fields })); });
}

describe('useEmployeeMaintenance', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        authState.user = { uid: 'emp-1', displayName: '구글이름' };
        authState.userData = { organizationId: 'org-A', name: '김직원' };
        mockGetVehicles.mockResolvedValue(VEHICLES);
        mockGetRecords.mockResolvedValue([MINE, OTHERS]);
        mockCreate.mockResolvedValue('new-id');
        mockUpdate.mockResolvedValue(undefined);
        mockDelete.mockResolvedValue(undefined);
        mockConfirm.mockResolvedValue(true);
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    describe('초기 로드', () => {
        it('기관 ID로 차량·정비 기록을 읽고 기록에 차종을 붙인다', async () => {
            const { result } = await renderReady();

            expect(mockGetVehicles).toHaveBeenCalledWith('org-A');
            expect(mockGetRecords).toHaveBeenCalledWith('org-A');
            expect(result.current.enrichedRecords.map(r => [r.id, r.vehicleType])).toEqual([
                ['m1', 'sedan'],
                ['m2', null], // 없어진 차량
            ]);
            expect(result.current.currentUid).toBe('emp-1');
        });

        it('기관 ID가 없으면 조회하지 않는다', async () => {
            authState.userData = null;

            const { result } = await renderReady();

            expect(mockGetVehicles).not.toHaveBeenCalled();
            expect(result.current.enrichedRecords).toEqual([]);
        });

        it('조회가 실패해도 로딩을 끝낸다', async () => {
            mockGetRecords.mockRejectedValue(new Error('offline'));

            const { result } = await renderReady();

            expect(result.current.enrichedRecords).toEqual([]);
        });
    });

    it('차량을 고르면 차량명도 함께 채운다 (없는 차량이면 빈 이름)', async () => {
        const { result } = await renderReady();

        act(() => { result.current.handleVehicleSelect('v2'); });
        expect(result.current.form).toMatchObject({ vehicleId: 'v2', vehicleName: '스타리아' });

        act(() => { result.current.handleVehicleSelect('zzz'); });
        expect(result.current.form).toMatchObject({ vehicleId: 'zzz', vehicleName: '' });
    });

    describe('수정 열기', () => {
        it('본인 기록이면 폼을 기록 값으로 채우고 수정 모드로 연다', async () => {
            const { result } = await renderReady();

            act(() => { result.current.handleEdit(MINE); });

            expect(result.current.editingId).toBe('m1');
            expect(result.current.showForm).toBe(true);
            expect(result.current.form).toEqual({
                vehicleId: 'v1', vehicleName: '쏘나타', date: '2026-11-01', type: 'repair',
                description: '타이어 교체', cost: '120000', shop: '동네카센터', km: '52000',
            });
        });

        it('비어 있는 선택 항목은 빈 문자열로 연다', async () => {
            const { result } = await renderReady();
            const sparse = { ...OTHERS, createdByUid: 'emp-1' } as MaintenanceRecord;

            act(() => { result.current.handleEdit(sparse); });

            expect(result.current.form).toMatchObject({ vehicleName: '', description: '', cost: '', shop: '', km: '' });
        });

        it('남의 기록은 열지 않는다', async () => {
            const { result } = await renderReady();

            act(() => { result.current.handleEdit(OTHERS); });

            expect(result.current.editingId).toBeNull();
            expect(result.current.showForm).toBe(false);
            expect(mockShowToast).toHaveBeenCalledWith('본인이 작성한 기록만 수정할 수 있습니다.', 'warning');
        });

        it('수정 취소는 폼을 처음 상태로 되돌린다', async () => {
            const { result } = await renderReady();
            act(() => { result.current.handleEdit(MINE); });

            act(() => { result.current.handleCancelEdit(); });

            expect(result.current.editingId).toBeNull();
            expect(result.current.showForm).toBe(false);
            expect(result.current.form).toMatchObject({ vehicleId: '', date: '2026-11-24', type: 'repair', cost: '' });
        });

        // 2026-11-24 수정: 기본 날짜가 모듈 로드 시점에 고정돼, 앱을 켜 둔 채 자정을 넘기면 전날로 남았다.
        it('자정을 넘긴 뒤 폼을 비우면 기본 날짜가 그날로 바뀐다', async () => {
            const { result } = await renderReady();
            act(() => { result.current.handleEdit(MINE); });
            mockToday.value = '2026-11-25';
            try {
                act(() => { result.current.handleCancelEdit(); });
                expect(result.current.form.date).toBe('2026-11-25');
            } finally {
                mockToday.value = '2026-11-24';
            }
        });
    });

    describe('저장', () => {
        it('새 기록은 기관 ID·작성자·차단 안 함으로 저장하고 목록을 다시 읽는다', async () => {
            const { result } = await renderReady();
            await fillForm(result, {
                vehicleId: 'v1', vehicleName: '쏘나타', description: '  엔진오일  ', cost: '1e5', shop: ' 카센터 ', km: '52000.7',
            });
            mockGetRecords.mockResolvedValue([MINE]);

            await act(async () => { await result.current.handleSubmit(submitEvent()); });

            expect(mockCreate).toHaveBeenCalledWith({
                organizationId: 'org-A',
                vehicleId: 'v1',
                vehicleName: '쏘나타',
                date: '2026-11-24',
                type: 'repair',
                description: '엔진오일',
                cost: 100000, // 지수 표기를 parseInt처럼 1로 읽지 않는다
                shop: '카센터',
                km: 52000,
                createdByUid: 'emp-1',
                createdByName: '김직원',
                blockVehicle: false,
            });
            expect(mockGetRecords).toHaveBeenLastCalledWith('org-A');
            expect(result.current.enrichedRecords).toHaveLength(1);
            expect(result.current.showForm).toBe(false);
            expect(result.current.saving).toBe(false);
            expect(mockShowToast).toHaveBeenCalledWith('정비 기록이 저장되었습니다.', 'success');
        });

        it('비용·주행거리를 비우면 null로 저장한다', async () => {
            const { result } = await renderReady();
            await fillForm(result, { vehicleId: 'v1' });

            await act(async () => { await result.current.handleSubmit(submitEvent()); });

            expect(mockCreate.mock.calls[0][0]).toMatchObject({ cost: null, km: null });
        });

        it('프로필 이름이 없으면 계정 표시 이름을 작성자명으로 쓴다', async () => {
            authState.userData = { organizationId: 'org-A' };
            const { result } = await renderReady();
            await fillForm(result, { vehicleId: 'v1' });

            await act(async () => { await result.current.handleSubmit(submitEvent()); });

            expect(mockCreate.mock.calls[0][0].createdByName).toBe('구글이름');
        });

        it('수정 모드면 같은 페이로드로 그 기록을 갱신한다', async () => {
            const { result } = await renderReady();
            act(() => { result.current.handleEdit(MINE); });
            await fillForm(result, { cost: '130000' });

            await act(async () => { await result.current.handleSubmit(submitEvent()); });

            expect(mockCreate).not.toHaveBeenCalled();
            expect(mockUpdate).toHaveBeenCalledWith('m1', expect.objectContaining({
                organizationId: 'org-A', cost: 130000, blockVehicle: false, createdByUid: 'emp-1',
            }));
            expect(result.current.editingId).toBeNull();
            expect(mockShowToast).toHaveBeenCalledWith('정비 기록이 수정되었습니다.', 'success');
        });

        it.each([
            ['차량', { vehicleId: '' }],
            ['날짜', { vehicleId: 'v1', date: '' }],
            ['유형', { vehicleId: 'v1', type: '' }],
        ])('%s이 비면 저장하지 않는다', async (_label, fields) => {
            const { result } = await renderReady();
            await fillForm(result, fields);

            await act(async () => { await result.current.handleSubmit(submitEvent()); });

            expect(mockCreate).not.toHaveBeenCalled();
            expect(mockShowToast).toHaveBeenCalledWith('차량ㆍ날짜ㆍ유형은 필수입니다.', 'warning');
        });

        it.each([
            ['비용', { cost: '-1000' }],
            ['주행거리', { km: '-5' }],
        ])('%s가 음수면 저장하지 않는다', async (label, fields) => {
            const { result } = await renderReady();
            await fillForm(result, { vehicleId: 'v1', ...fields });

            await act(async () => { await result.current.handleSubmit(submitEvent()); });

            expect(mockCreate).not.toHaveBeenCalled();
            expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining(label), 'warning');
        });

        it('저장이 실패하면 폼을 닫지 않고 오류 토스트를 낸다', async () => {
            mockCreate.mockRejectedValue(new Error('permission-denied'));
            const { result } = await renderReady();
            act(() => { result.current.setShowForm(true); });
            await fillForm(result, { vehicleId: 'v1' });

            await act(async () => { await result.current.handleSubmit(submitEvent()); });

            expect(result.current.showForm).toBe(true);
            expect(result.current.saving).toBe(false);
            expect(result.current.form.vehicleId).toBe('v1');
            expect(mockShowToast).toHaveBeenCalledWith('저장에 실패했습니다.', 'error');
        });
    });

    describe('삭제', () => {
        it('본인 기록은 확인 후 지우고 목록에서 뺀다', async () => {
            const { result } = await renderReady();

            await act(async () => { await result.current.handleDelete(MINE); });

            expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ confirmColor: 'danger' }));
            expect(mockDelete).toHaveBeenCalledWith('m1');
            expect(result.current.enrichedRecords.map(r => r.id)).toEqual(['m2']);
        });

        it('남의 기록은 확인창 없이 막는다', async () => {
            const { result } = await renderReady();

            await act(async () => { await result.current.handleDelete(OTHERS); });

            expect(mockConfirm).not.toHaveBeenCalled();
            expect(mockDelete).not.toHaveBeenCalled();
            expect(mockShowToast).toHaveBeenCalledWith('본인이 작성한 기록만 삭제할 수 있습니다.', 'warning');
        });

        it('확인창에서 취소하면 지우지 않는다', async () => {
            mockConfirm.mockResolvedValue(false);
            const { result } = await renderReady();

            await act(async () => { await result.current.handleDelete(MINE); });

            expect(mockDelete).not.toHaveBeenCalled();
        });

        it('삭제가 실패하면 목록을 그대로 두고 오류 토스트를 낸다', async () => {
            mockDelete.mockRejectedValue(new Error('permission-denied'));
            const { result } = await renderReady();

            await act(async () => { await result.current.handleDelete(MINE); });

            expect(result.current.enrichedRecords).toHaveLength(2);
            expect(mockShowToast).toHaveBeenCalledWith('삭제에 실패했습니다.', 'error');
        });
    });
});
