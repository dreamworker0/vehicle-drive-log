/**
 * auditLog.test — 변경 로그 트리거
 *
 * 고시 제16조의 접속기록이므로 (1) 누락되지 않고 (2) 개인정보 값을 담지 않으며
 * (3) 실패해도 원본 문서 처리를 방해하지 않아야 한다. 세 가지를 모두 고정한다.
 */

/** onDocument* 트리거 핸들러를 이름으로 캡처한다 */
const capturedTriggers: Record<string, any> = {};
const capturedDocPaths: Record<string, string> = {};

jest.mock('firebase-functions/v2/firestore', () => {
    const capture = (kind: string) => (opts: any, handler: any) => {
        // export 순서대로 호출되므로 document 경로 + kind로 키를 만든다
        const key = `${opts.document}:${kind}`;
        capturedTriggers[key] = handler;
        capturedDocPaths[key] = opts.document;
        return handler;
    };
    return {
        onDocumentCreated: capture('create'),
        onDocumentUpdated: capture('update'),
        onDocumentDeleted: capture('delete'),
    };
});

const mockAdd = jest.fn().mockResolvedValue({ id: 'audit-1' });

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: (name: string) => {
            if (name !== 'auditLogs') throw new Error(`예상하지 못한 컬렉션 접근: ${name}`);
            return { add: mockAdd };
        },
    }),
    FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TS') },
    Timestamp: { fromMillis: jest.fn((ms: number) => ({ __ms: ms })) },
}));

const mockLog = jest.fn();
jest.mock('../utils/helpers', () => ({
    log: (...args: unknown[]) => mockLog(...args),
}));

require('../handlers/triggers/auditLog');

/** 트리거 호출 헬퍼 */
const fireCreate = (path: string, params: any, data: any) =>
    capturedTriggers[`${path}:create`]({ params, data: { data: () => data } });

const fireUpdate = (path: string, params: any, before: any, after: any) =>
    capturedTriggers[`${path}:update`]({
        params,
        data: { before: { data: () => before }, after: { data: () => after } },
    });

const fireDelete = (path: string, params: any, data: any) =>
    capturedTriggers[`${path}:delete`]({ params, data: { data: () => data } });

const DRIVE_LOG = 'driveLogs/{logId}';
const USER = 'users/{userId}';

describe('auditLog — 운행일지', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAdd.mockResolvedValue({ id: 'audit-1' });
    });

    it('생성: 작성자·정보주체·보관 만료를 기록한다', async () => {
        await fireCreate(DRIVE_LOG, { logId: 'dl-1' }, {
            organizationId: 'org-1',
            createdByUid: 'writer-1',
            driverUid: 'driver-1',
            coDriverUids: ['co-1'],
        });

        expect(mockAdd).toHaveBeenCalledTimes(1);
        const entry = mockAdd.mock.calls[0][0];
        expect(entry).toMatchObject({
            organizationId: 'org-1',
            action: 'create',
            targetType: 'driveLog',
            targetId: 'dl-1',
            actorUid: 'writer-1',
            actorSource: 'document',
            at: 'SERVER_TS',
        });
        expect(entry.subjectUids).toEqual(expect.arrayContaining(['driver-1', 'co-1']));
        expect(entry.expiresAt).toBeDefined();
    });

    it('생성: 작성자 uid가 없으면 대표 운전자로 대체한다', async () => {
        await fireCreate(DRIVE_LOG, { logId: 'dl-2' }, {
            organizationId: 'org-1', driverUid: 'driver-2',
        });
        expect(mockAdd.mock.calls[0][0]).toMatchObject({
            actorUid: 'driver-2', actorSource: 'document',
        });
    });

    it('생성: 행위자를 알 수 없으면 null + unknown으로 남긴다', async () => {
        await fireCreate(DRIVE_LOG, { logId: 'dl-3' }, { organizationId: 'org-1' });
        expect(mockAdd.mock.calls[0][0]).toMatchObject({
            actorUid: null, actorSource: 'unknown',
        });
    });

    it('수정: 변경된 필드명만 남기고 값은 남기지 않는다', async () => {
        await fireUpdate(DRIVE_LOG, { logId: 'dl-4' },
            { organizationId: 'org-1', driverUid: 'd1', endKm: 100, destination: '구청', purpose: '민원' },
            { organizationId: 'org-1', driverUid: 'd1', endKm: 150, destination: '시청', purpose: '민원' },
        );

        const entry = mockAdd.mock.calls[0][0];
        expect(entry.changedFields).toEqual(['destination', 'endKm']);
        // 감사 로그가 개인정보 스냅샷이 되면 그 로그도 보호 대상이 된다
        expect(JSON.stringify(entry)).not.toContain('구청');
        expect(JSON.stringify(entry)).not.toContain('시청');
        expect(JSON.stringify(entry)).not.toContain('150');
    });

    it('수정: 메타 필드만 바뀐 쓰기는 기록하지 않는다', async () => {
        // editedAt은 쓰기마다 바뀌므로 이를 세면 실제 변경 없는 로그가 쌓인다
        await fireUpdate(DRIVE_LOG, { logId: 'dl-5' },
            { organizationId: 'org-1', endKm: 100, editedAt: 'T1' },
            { organizationId: 'org-1', endKm: 100, editedAt: 'T2' },
        );
        expect(mockAdd).not.toHaveBeenCalled();
    });

    it('수정: 행위자는 알 수 없음으로 남긴다 (트리거 한계)', async () => {
        await fireUpdate(DRIVE_LOG, { logId: 'dl-6' },
            { organizationId: 'org-1', endKm: 100 },
            { organizationId: 'org-1', endKm: 200 },
        );
        expect(mockAdd.mock.calls[0][0]).toMatchObject({ actorUid: null, actorSource: 'unknown' });
    });

    it('삭제: 삭제 시점 스냅샷으로 기관·정보주체를 남긴다', async () => {
        await fireDelete(DRIVE_LOG, { logId: 'dl-7' }, {
            organizationId: 'org-1', driverUid: 'driver-7',
        });
        expect(mockAdd.mock.calls[0][0]).toMatchObject({
            action: 'delete', targetType: 'driveLog', targetId: 'dl-7', organizationId: 'org-1',
        });
        expect(mockAdd.mock.calls[0][0].subjectUids).toEqual(['driver-7']);
    });

    it('기관을 특정할 수 없는 문서는 기록하지 않는다', async () => {
        // organizationId 없는 로그는 기관 관리자의 점검 조회에서 고아가 된다
        await fireCreate(DRIVE_LOG, { logId: 'dl-8' }, { driverUid: 'd8' });
        expect(mockAdd).not.toHaveBeenCalled();
    });

    it('기록 실패는 throw하지 않고 ERROR 로그만 남긴다', async () => {
        // 감사 로그 실패가 원본 문서 처리를 되돌리거나 재시도시키면 안 된다
        mockAdd.mockRejectedValueOnce(new Error('quota exceeded'));

        await expect(
            fireCreate(DRIVE_LOG, { logId: 'dl-9' }, { organizationId: 'org-1', driverUid: 'd9' })
        ).resolves.toBeUndefined();

        expect(mockLog).toHaveBeenCalledWith('ERROR', 'auditLog', expect.any(String), expect.objectContaining({
            targetId: 'dl-9',
        }));
    });
});

describe('auditLog — 사용자', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAdd.mockResolvedValue({ id: 'audit-1' });
    });

    it('생성: 가입은 본인 행위로 기록한다', async () => {
        await fireCreate(USER, { userId: 'u-1' }, { organizationId: 'org-1', email: 'a@b.c' });
        expect(mockAdd.mock.calls[0][0]).toMatchObject({
            action: 'create', targetType: 'user', targetId: 'u-1',
            actorUid: 'u-1', actorSource: 'document', subjectUids: ['u-1'],
        });
    });

    it('수정: 권한 변경(role)이 변경 필드로 남는다 — 고시 제5조 권한 기록 겸용', async () => {
        await fireUpdate(USER, { userId: 'u-2' },
            { organizationId: 'org-1', role: 'employee', name: '홍길동' },
            { organizationId: 'org-1', role: 'admin', name: '홍길동' },
        );
        expect(mockAdd.mock.calls[0][0].changedFields).toEqual(['role']);
    });

    it('수정: 개인정보 값(이름·전화)은 필드명만 남고 값은 남지 않는다', async () => {
        await fireUpdate(USER, { userId: 'u-3' },
            { organizationId: 'org-1', name: '홍길동', phone: '010-1111-2222' },
            { organizationId: 'org-1', name: '이순신', phone: '010-3333-4444' },
        );
        const entry = mockAdd.mock.calls[0][0];
        expect(entry.changedFields).toEqual(['name', 'phone']);
        expect(JSON.stringify(entry)).not.toContain('이순신');
        expect(JSON.stringify(entry)).not.toContain('010-3333-4444');
    });

    it('수정: 기관 이전은 이전 소속 기준으로 남긴다', async () => {
        // 탈퇴 후 재가입에서 이전 소속 기관의 점검 대상이어야 한다
        await fireUpdate(USER, { userId: 'u-4' },
            { organizationId: 'org-old', role: 'employee' },
            { organizationId: null, role: 'employee' },
        );
        expect(mockAdd.mock.calls[0][0].organizationId).toBe('org-old');
    });

    it('삭제: 삭제 스냅샷으로 기록한다', async () => {
        await fireDelete(USER, { userId: 'u-5' }, { organizationId: 'org-1', email: 'a@b.c' });
        expect(mockAdd.mock.calls[0][0]).toMatchObject({
            action: 'delete', targetType: 'user', targetId: 'u-5', subjectUids: ['u-5'],
        });
    });
});
