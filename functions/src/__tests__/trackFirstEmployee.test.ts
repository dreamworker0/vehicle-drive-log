/**
 * trackFirstEmployee.test.ts
 * - 첫 직원 등록 시점 기록 Firestore 트리거 단위 테스트
 * - onDocumentCreated mock으로 핸들러만 추출하여 테스트
 */

// ── Firestore Mock ──
const mockOrgGet = jest.fn();
const mockOrgUpdate = jest.fn().mockResolvedValue(undefined);
const mockOrgRef = { get: mockOrgGet, update: mockOrgUpdate };

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: jest.fn(() => ({
            doc: jest.fn(() => mockOrgRef),
        })),
    }),
    FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}));

// onDocumentCreated mock: handler를 직접 반환하도록
jest.mock('firebase-functions/firestore', () => ({
    onDocumentCreated: (_opts: unknown, handler: (event: unknown) => unknown) => handler,
}));

import { trackFirstEmployee } from "../handlers/triggers/trackFirstEmployee";

const handler = trackFirstEmployee as unknown as (event: Record<string, unknown>) => Promise<void>;

describe('trackFirstEmployee — 첫 직원 등록 시점 기록', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('userData가 없으면 아무것도 하지 않는다', async () => {
        const event = { data: null };
        await handler(event);
        expect(mockOrgGet).not.toHaveBeenCalled();
    });

    it('organizationId가 없으면 아무것도 하지 않는다', async () => {
        const event = {
            data: { data: () => ({ role: 'employee' }) }, // organizationId 없음
        };
        await handler(event);
        expect(mockOrgGet).not.toHaveBeenCalled();
    });

    it('superAdmin은 스킵한다', async () => {
        const event = {
            data: { data: () => ({ role: 'superAdmin', organizationId: 'org1' }) },
        };
        await handler(event);
        expect(mockOrgGet).not.toHaveBeenCalled();
    });

    it('기관 문서가 없으면 update를 호출하지 않는다', async () => {
        mockOrgGet.mockResolvedValueOnce({ exists: false });

        const event = {
            data: { data: () => ({ role: 'employee', organizationId: 'org1' }) },
        };
        await handler(event);
        expect(mockOrgUpdate).not.toHaveBeenCalled();
    });

    it('이미 firstEmployeeRegisteredAt이 있으면 update를 호출하지 않는다', async () => {
        mockOrgGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                firstEmployeeRegisteredAt: new Date(),
                status: 'approved',
            }),
        });

        const event = {
            data: { data: () => ({ role: 'employee', organizationId: 'org1' }) },
        };
        await handler(event);
        expect(mockOrgUpdate).not.toHaveBeenCalled();
    });

    it('첫 직원 등록 시 firstEmployeeRegisteredAt을 기록한다', async () => {
        const approvedAt = {
            toDate: () => new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5일 전
        };
        mockOrgGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                status: 'approved',
                approvedAt,
                // firstEmployeeRegisteredAt 없음
            }),
        });

        const event = {
            data: { data: () => ({ role: 'employee', organizationId: 'org1' }) },
        };
        await handler(event);

        expect(mockOrgUpdate).toHaveBeenCalledTimes(1);
        const updateArg = mockOrgUpdate.mock.calls[0][0] as Record<string, unknown>;
        expect(updateArg.firstEmployeeRegisteredAt).toBe('SERVER_TIMESTAMP');
        expect(typeof updateArg.timeToFirstEmployeeDays).toBe('number');
        expect(updateArg.timeToFirstEmployeeDays).toBeGreaterThanOrEqual(4); // 약 5일
    });

    it('approvedAt이 없고 createdAt이 있으면 createdAt 기준으로 소요일을 계산한다', async () => {
        const createdAt = {
            toDate: () => new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10일 전
        };
        mockOrgGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                status: 'approved',
                createdAt,
                // approvedAt, firstEmployeeRegisteredAt 없음
            }),
        });

        const event = {
            data: { data: () => ({ role: 'employee', organizationId: 'org1' }) },
        };
        await handler(event);

        expect(mockOrgUpdate).toHaveBeenCalledTimes(1);
        const updateArg = mockOrgUpdate.mock.calls[0][0] as Record<string, unknown>;
        expect(updateArg.timeToFirstEmployeeDays).toBeGreaterThanOrEqual(9);
    });

    it('approvedAt과 createdAt 모두 없으면 timeToFirstEmployeeDays를 기록하지 않는다', async () => {
        mockOrgGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({ status: 'approved' }),
        });

        const event = {
            data: { data: () => ({ role: 'employee', organizationId: 'org1' }) },
        };
        await handler(event);

        expect(mockOrgUpdate).toHaveBeenCalledTimes(1);
        const updateArg = mockOrgUpdate.mock.calls[0][0] as Record<string, unknown>;
        expect(updateArg.firstEmployeeRegisteredAt).toBe('SERVER_TIMESTAMP');
        expect(updateArg.timeToFirstEmployeeDays).toBeUndefined();
    });
});
