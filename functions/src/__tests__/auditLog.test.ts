/**
 * auditLog.test — 변경 로그 트리거
 *
 * 고시 제16조의 접속기록이므로 다음을 모두 고정한다.
 *  (1) 개인정보·권한 필드 변경은 빠짐없이 남는다
 *  (2) 그 밖의 쓰기(km 연쇄 동기화·UI 선호·임의 주입 필드)는 남지 않는다
 *  (3) 개인정보 **값**은 절대 담지 않는다 (키 집합을 고정해 검증)
 *  (4) 보관기간(1년)·리전·retry·멱등 문서 ID가 코드에 고정돼 있다
 *  (5) 실패는 삼키지 않고 재시도에 맡긴다
 */
import * as fs from 'fs';
import * as path from 'path';

/** onDocument* 트리거 핸들러와 옵션을 경로+종류로 캡처한다 */
const capturedTriggers: Record<string, any> = {};
const capturedOpts: Record<string, any> = {};

jest.mock('firebase-functions/v2/firestore', () => {
    const capture = (kind: string) => (opts: any, handler: any) => {
        const key = `${opts.document}:${kind}`;
        capturedTriggers[key] = handler;
        capturedOpts[key] = opts;
        return handler;
    };
    return {
        onDocumentCreated: capture('create'),
        onDocumentUpdated: capture('update'),
        onDocumentDeleted: capture('delete'),
    };
});

const mockSet = jest.fn().mockResolvedValue(undefined);
/** set이 호출된 문서 ID를 순서대로 기록한다 (멱등 검증용) */
const capturedDocIds: string[] = [];

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: (name: string) => {
            if (name !== 'auditLogs') throw new Error(`예상하지 못한 컬렉션 접근: ${name}`);
            return {
                doc: (id: string) => {
                    capturedDocIds.push(id);
                    return { set: mockSet };
                },
            };
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
 
const { Timestamp } = require('firebase-admin/firestore');

/** 트리거 호출 헬퍼 — event.id가 멱등 문서 ID에 들어가므로 항상 넘긴다 */
const fireCreate = (path: string, params: any, data: any, id = 'evt-1') =>
    capturedTriggers[`${path}:create`]({ id, params, data: { data: () => data } });

const fireUpdate = (path: string, params: any, before: any, after: any, id = 'evt-1') =>
    capturedTriggers[`${path}:update`]({
        id, params,
        data: { before: { data: () => before }, after: { data: () => after } },
    });

const fireDelete = (path: string, params: any, data: any, id = 'evt-1') =>
    capturedTriggers[`${path}:delete`]({ id, params, data: { data: () => data } });

const DRIVE_LOG = 'driveLogs/{logId}';
const USER = 'users/{userId}';

/** 마지막으로 기록된 감사 엔트리 */
const lastEntry = () => mockSet.mock.calls[mockSet.mock.calls.length - 1][0];

beforeEach(() => {
    jest.clearAllMocks();
    capturedDocIds.length = 0;
    mockSet.mockResolvedValue(undefined);
});

describe('auditLog — 트리거 배선', () => {
    it('6개 트리거가 driveLogs·users의 생성/수정/삭제에 정확히 걸린다', () => {
        expect(Object.keys(capturedTriggers).sort()).toEqual([
            'driveLogs/{logId}:create',
            'driveLogs/{logId}:delete',
            'driveLogs/{logId}:update',
            'users/{userId}:create',
            'users/{userId}:delete',
            'users/{userId}:update',
        ]);
    });

    it('모든 트리거가 서울 리전 + retry로 등록된다', () => {
        // retry가 없으면 v2 트리거는 실패한 이벤트를 폐기한다 — 법정 기록이 조용히 사라진다.
        for (const [key, opts] of Object.entries(capturedOpts)) {
            expect({ key, ...opts }).toMatchObject({
                key, region: 'asia-northeast3', memory: '256MiB', retry: true,
            });
        }
    });

    it('index.ts가 6개 트리거를 전부 export한다', () => {
        // export하지 않으면 배포되지 않는다(CLAUDE.md 절대 규칙 #3). 소스를 직접 읽어 고정한다 —
        // index.ts를 import하면 firebase-admin 초기화까지 끌려와 단위 테스트에 부적합하다.
        const src = fs.readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf-8');
        for (const name of [
            'auditDriveLogCreated', 'auditDriveLogUpdated', 'auditDriveLogDeleted',
            'auditUserCreated', 'auditUserUpdated', 'auditUserDeleted',
        ]) {
            expect(src).toContain(name);
        }
        expect(src).toContain('./handlers/triggers/auditLog');
    });
});

describe('auditLog — 기록 형식·보관기간', () => {
    it('감사 엔트리의 키 집합이 고정된다 — 값 필드가 새로 끼어들면 실패한다', async () => {
        // toMatchObject는 추가된 키를 못 잡는다. 개인정보 값 필드(beforeValue 등)가
        // 슬쩍 들어오는 것을 막으려면 키 집합 자체를 단정해야 한다.
        await fireUpdate(DRIVE_LOG, { logId: 'dl-1' },
            { organizationId: 'org-1', driverUid: 'd1', destination: '구청' },
            { organizationId: 'org-1', driverUid: 'd1', destination: '시청' },
        );
        expect(Object.keys(lastEntry()).sort()).toEqual([
            'action', 'actorSource', 'actorUid', 'at', 'changedFields',
            'expiresAt', 'organizationId', 'subjectUids', 'targetId', 'targetType',
        ]);
    });

    it('보관기간이 정확히 365일로 고정된다', async () => {
        // toBeDefined()만 두면 RETENTION_DAYS를 1로 바꿔도 통과한다 — 법정 보관기간을 고정한다.
        const before = Date.now();
        await fireCreate(DRIVE_LOG, { logId: 'dl-2' }, { organizationId: 'org-1', driverUid: 'd2' });
        const after = Date.now();

        expect(Timestamp.fromMillis).toHaveBeenCalledTimes(1);
        const ms = Timestamp.fromMillis.mock.calls[0][0];
        const oneYear = 365 * 24 * 60 * 60 * 1000;
        expect(ms).toBeGreaterThanOrEqual(before + oneYear);
        expect(ms).toBeLessThanOrEqual(after + oneYear);
    });

    it('문서 ID가 대상+이벤트ID로 고정돼 재시도가 중복을 만들지 않는다', async () => {
        await fireCreate(DRIVE_LOG, { logId: 'dl-3' }, { organizationId: 'org-1', driverUid: 'd3' }, 'evt-abc');
        // 같은 이벤트가 재전달되면 같은 ID로 덮어쓴다
        await fireCreate(DRIVE_LOG, { logId: 'dl-3' }, { organizationId: 'org-1', driverUid: 'd3' }, 'evt-abc');
        expect(capturedDocIds).toEqual(['driveLog_dl-3_evt-abc', 'driveLog_dl-3_evt-abc']);
    });

    it('기록 실패는 ERROR 로그를 남기고 다시 throw해 재시도에 맡긴다', async () => {
        // 삼키면 retry가 무의미해진다 — 법정 기록이 조용히 사라진다.
        mockSet.mockRejectedValueOnce(new Error('quota exceeded'));

        await expect(
            fireCreate(DRIVE_LOG, { logId: 'dl-4' }, { organizationId: 'org-1', driverUid: 'd4' })
        ).rejects.toThrow('quota exceeded');

        expect(mockLog).toHaveBeenCalledWith('ERROR', 'auditLog', expect.any(String),
            expect.objectContaining({ targetId: 'dl-4' }));
    });
});

describe('auditLog — 운행일지', () => {
    it('생성: 작성자·정보주체·보관 만료를 기록한다', async () => {
        await fireCreate(DRIVE_LOG, { logId: 'dl-10' }, {
            organizationId: 'org-1',
            createdByUid: 'writer-1',
            driverUid: 'driver-1',
            coDriverUids: ['co-1'],
        });

        expect(mockSet).toHaveBeenCalledTimes(1);
        expect(lastEntry()).toMatchObject({
            organizationId: 'org-1',
            action: 'create',
            targetType: 'driveLog',
            targetId: 'dl-10',
            actorUid: 'writer-1',
            actorSource: 'document',
            at: 'SERVER_TS',
        });
        expect(lastEntry().subjectUids).toEqual(expect.arrayContaining(['driver-1', 'co-1']));
    });

    it('생성: 작성자 uid가 없으면 대표 운전자로 대체한다', async () => {
        await fireCreate(DRIVE_LOG, { logId: 'dl-11' }, { organizationId: 'org-1', driverUid: 'driver-2' });
        expect(lastEntry()).toMatchObject({ actorUid: 'driver-2', actorSource: 'document' });
    });

    it('생성: 행위자를 알 수 없으면 null + unknown으로 남긴다', async () => {
        await fireCreate(DRIVE_LOG, { logId: 'dl-12' }, { organizationId: 'org-1' });
        expect(lastEntry()).toMatchObject({ actorUid: null, actorSource: 'unknown' });
    });

    it('수정: 개인정보 필드 변경은 필드명만 남기고 값은 남기지 않는다', async () => {
        await fireUpdate(DRIVE_LOG, { logId: 'dl-13' },
            { organizationId: 'org-1', driverUid: 'd1', destination: '구청', purpose: '민원', passengerNames: ['김철수'] },
            { organizationId: 'org-1', driverUid: 'd1', destination: '시청', purpose: '민원', passengerNames: ['이영희'] },
        );

        const entry = lastEntry();
        expect(entry.changedFields).toEqual(['destination', 'passengerNames']);
        // 감사 로그가 개인정보 스냅샷이 되면 그 로그도 보호 대상이 된다
        const dump = JSON.stringify(entry);
        for (const value of ['구청', '시청', '김철수', '이영희']) {
            expect(dump).not.toContain(value);
        }
    });

    it('수정: 탑승자는 정보주체 배열에 넣지 않는다 (이름만 저장돼 최소수집에 반한다)', async () => {
        await fireUpdate(DRIVE_LOG, { logId: 'dl-14' },
            { organizationId: 'org-1', driverUid: 'd1', passengerNames: [] },
            { organizationId: 'org-1', driverUid: 'd1', passengerNames: ['외부 이용자'] },
        );
        expect(lastEntry().subjectUids).toEqual(['d1']);
    });

    it('수정: km 연쇄 동기화는 기록하지 않는다', async () => {
        // syncNextLogStartKm은 한 번의 정정으로 수백~수천 건의 startKm/endKm 쓰기를 만든다.
        // 이를 기록하면 사람의 편집이 시스템 파급에 묻혀 제16조 ②의 점검이 불가능해진다.
        await fireUpdate(DRIVE_LOG, { logId: 'dl-15' },
            { organizationId: 'org-1', driverUid: 'd1', startKm: 100, endKm: 150, editedAt: 'T1' },
            { organizationId: 'org-1', driverUid: 'd1', startKm: 120, endKm: 170, editedAt: 'T2' },
        );
        expect(mockSet).not.toHaveBeenCalled();
    });

    it('수정: 클라이언트가 주입한 임의 필드명은 기록되지 않는다', async () => {
        // driveLogs create 규칙에 hasOnly가 없어 임의 필드를 넣을 수 있다. 블랙리스트였다면
        // 필드명에 개인정보를 담아 삭제 불가능한 컬렉션에 1년간 박아 넣을 수 있었다.
        await fireUpdate(DRIVE_LOG, { logId: 'dl-16' },
            { organizationId: 'org-1', driverUid: 'd1' },
            { organizationId: 'org-1', driverUid: 'd1', '홍길동-010-1234-5678': 1, evilField: 2 },
        );
        expect(mockSet).not.toHaveBeenCalled();
    });

    it('수정: 행위자 스탬프가 있으면 수정자로 기록한다 (Phase 2 ①)', async () => {
        await fireUpdate(DRIVE_LOG, { logId: 'dl-17' },
            { organizationId: 'org-1', destination: 'A' },
            { organizationId: 'org-1', destination: 'B', lastEditedByUid: 'editor-9' },
        );
        // Rules가 request.auth.uid와의 일치를 강제하므로 이 값은 위조될 수 없다
        expect(lastEntry()).toMatchObject({ actorUid: 'editor-9', actorSource: 'stamp' });
    });

    it('수정: 스탬프가 없으면 추정하지 않고 unknown으로 남긴다', async () => {
        // 서버(Admin SDK) 쓰기는 Rules를 우회하고 스탬프도 심지 않는다.
        // 작성자(createdByUid)로 대체 추정하면 무고한 사용자에게 책임이 귀속된다.
        await fireUpdate(DRIVE_LOG, { logId: 'dl-17b' },
            { organizationId: 'org-1', destination: 'A', createdByUid: 'author-1' },
            { organizationId: 'org-1', destination: 'B', createdByUid: 'author-1' },
        );
        expect(lastEntry()).toMatchObject({ actorUid: null, actorSource: 'unknown' });
    });

    it('수정: 스탬프가 빈 문자열이면 행위자로 인정하지 않는다', async () => {
        await fireUpdate(DRIVE_LOG, { logId: 'dl-17c' },
            { organizationId: 'org-1', destination: 'A' },
            { organizationId: 'org-1', destination: 'B', lastEditedByUid: '' },
        );
        expect(lastEntry()).toMatchObject({ actorUid: null, actorSource: 'unknown' });
    });

    it('수정: 스탬프 자체는 변경 필드로 남지 않는다 (감사 노이즈 방지)', async () => {
        await fireUpdate(DRIVE_LOG, { logId: 'dl-17d' },
            { organizationId: 'org-1', destination: 'A', lastEditedByUid: 'old-editor' },
            { organizationId: 'org-1', destination: 'B', lastEditedByUid: 'new-editor' },
        );
        expect(lastEntry().changedFields).toEqual(['destination']);
    });

    it('수정: 스탬프만 바뀐 쓰기는 아예 기록하지 않는다', async () => {
        await fireUpdate(DRIVE_LOG, { logId: 'dl-17e' },
            { organizationId: 'org-1', destination: 'A' },
            { organizationId: 'org-1', destination: 'A', lastEditedByUid: 'editor-9' },
        );
        expect(mockSet).not.toHaveBeenCalled();
    });

    it('삭제: 남아 있는 스탬프를 삭제자로 적지 않는다', async () => {
        // 삭제된 문서의 lastEditedByUid는 마지막 '수정자'이지 '삭제자'가 아니다.
        // 이를 삭제자로 확언하면 무고한 사용자에게 책임이 귀속된다 — unknown보다 나쁘다.
        await fireDelete(DRIVE_LOG, { logId: 'dl-17f' },
            { organizationId: 'org-1', driverUid: 'driver-7', lastEditedByUid: 'editor-9' },
        );
        expect(lastEntry()).toMatchObject({ actorUid: null, actorSource: 'unknown' });
    });

    it('삭제: 삭제 시점 스냅샷으로 기관·정보주체를 남긴다', async () => {
        await fireDelete(DRIVE_LOG, { logId: 'dl-18' }, { organizationId: 'org-1', driverUid: 'driver-7' });
        expect(lastEntry()).toMatchObject({
            action: 'delete', targetType: 'driveLog', targetId: 'dl-18', organizationId: 'org-1',
        });
        expect(lastEntry().subjectUids).toEqual(['driver-7']);
    });
});

describe('auditLog — 사용자', () => {
    it('생성: 본인 가입은 본인 행위로 기록한다', async () => {
        await fireCreate(USER, { userId: 'u-1' }, { organizationId: 'org-1', email: 'a@b.c' });
        expect(lastEntry()).toMatchObject({
            action: 'create', targetType: 'user', targetId: 'u-1',
            actorUid: 'u-1', actorSource: 'document', subjectUids: ['u-1'],
        });
    });

    it('생성: 관리자 복원(restoredAt)은 본인을 행위자로 적지 않는다', async () => {
        // restoreUser는 superAdmin/관리자가 타인 문서를 재생성한다. 본인으로 적으면
        // 무고한 사용자에게 책임이 귀속되고, actorSource:'document'는 그 오기를 확언한다.
        await fireCreate(USER, { userId: 'u-2' }, {
            organizationId: 'org-1', email: 'a@b.c', restoredAt: 'T1',
        });
        expect(lastEntry()).toMatchObject({ actorUid: null, actorSource: 'unknown' });
    });

    it('수정: 권한 변경(role)이 변경 필드로 남는다 — 고시 제5조 권한 기록 겸용', async () => {
        await fireUpdate(USER, { userId: 'u-3' },
            { organizationId: 'org-1', role: 'employee', name: '홍길동' },
            { organizationId: 'org-1', role: 'admin', name: '홍길동' },
        );
        expect(lastEntry().changedFields).toEqual(['role']);
    });

    it('수정: 개인정보 값(이름·전화)은 필드명만 남고 값은 남지 않는다', async () => {
        await fireUpdate(USER, { userId: 'u-4' },
            { organizationId: 'org-1', name: '홍길동', phone: '010-1111-2222' },
            { organizationId: 'org-1', name: '이순신', phone: '010-3333-4444' },
        );
        const entry = lastEntry();
        expect(entry.changedFields).toEqual(['name', 'phone']);
        expect(JSON.stringify(entry)).not.toContain('이순신');
        expect(JSON.stringify(entry)).not.toContain('010-3333-4444');
    });

    it('수정: 동의 기록(consent) 변경은 처리 근거의 변동이므로 남긴다', async () => {
        await fireUpdate(USER, { userId: 'u-5' },
            { organizationId: 'org-1', consent: { terms: true, termsVersion: '2026-08-05' } },
            { organizationId: 'org-1', consent: { terms: true, termsVersion: '2027-01-01' } },
        );
        expect(lastEntry().changedFields).toEqual(['consent']);
    });

    it('수정: UI 선호·FCM 토큰은 기록하지 않는다', async () => {
        // 다크모드 토글·배너 닫기·토큰 회전은 개인정보 처리 행위가 아니다(최소수집).
        await fireUpdate(USER, { userId: 'u-6' },
            { organizationId: 'org-1', theme: 'light', welcomeDismissed: false, fcmToken: 'tok-1' },
            { organizationId: 'org-1', theme: 'dark', welcomeDismissed: true, fcmToken: 'tok-2' },
        );
        expect(mockSet).not.toHaveBeenCalled();
    });

    it('수정: 관리자가 타인 권한을 바꾸면 관리자가 행위자로 남는다 (고시 제5조)', async () => {
        await fireUpdate(USER, { userId: 'victim-1' },
            { organizationId: 'org-1', role: 'employee' },
            { organizationId: 'org-1', role: 'admin', lastEditedByUid: 'admin-1' },
        );
        expect(lastEntry()).toMatchObject({
            actorUid: 'admin-1',
            actorSource: 'stamp',
            subjectUids: ['victim-1'],
            changedFields: ['role'],
        });
    });

    it('수정: 기관 이전은 이전 소속 기준으로 남긴다', async () => {
        await fireUpdate(USER, { userId: 'u-7' },
            { organizationId: 'org-old', role: 'employee' },
            { organizationId: null, role: 'employee' },
        );
        expect(lastEntry().organizationId).toBe('org-old');
    });

    it('삭제: 삭제 스냅샷으로 기록한다', async () => {
        await fireDelete(USER, { userId: 'u-8' }, { organizationId: 'org-1', email: 'a@b.c' });
        expect(lastEntry()).toMatchObject({
            action: 'delete', targetType: 'user', targetId: 'u-8', subjectUids: ['u-8'],
        });
    });
});

describe('auditLog — 기관 미소속 계정 (superAdmin)', () => {
    // 예전에는 organizationId가 없으면 기록을 건너뛰어, 시스템 전체 권한을 가진 superAdmin
    // 계정의 생성·권한 변경·삭제가 한 줄도 남지 않았다. 가장 위험한 계정이 사각지대였다.

    it('생성: __system__ 기관으로 기록한다', async () => {
        await fireCreate(USER, { userId: 'sa-1' }, { email: 'root@x.com', role: 'superAdmin' });
        expect(lastEntry()).toMatchObject({ organizationId: '__system__', targetId: 'sa-1' });
    });

    it('수정: superAdmin의 권한 변경도 기록한다', async () => {
        await fireUpdate(USER, { userId: 'sa-2' },
            { role: 'admin', organizationId: null },
            { role: 'superAdmin', organizationId: null },
        );
        expect(lastEntry()).toMatchObject({ organizationId: '__system__', changedFields: ['role'] });
    });

    it('삭제: superAdmin 계정 삭제도 기록한다', async () => {
        await fireDelete(USER, { userId: 'sa-3' }, { email: 'root@x.com', role: 'superAdmin' });
        expect(lastEntry()).toMatchObject({ organizationId: '__system__', action: 'delete' });
    });
});

describe('auditLog — diffFieldNames 엣지 케이스', () => {
    it('배열 내용이 바뀌면 감지한다', async () => {
        await fireUpdate(DRIVE_LOG, { logId: 'e-1' },
            { organizationId: 'org-1', coDriverUids: ['a'] },
            { organizationId: 'org-1', coDriverUids: ['a', 'b'] },
        );
        expect(lastEntry().changedFields).toEqual(['coDriverUids']);
    });

    it('필드가 새로 생기거나 사라지는 것도 변경으로 본다', async () => {
        await fireUpdate(USER, { userId: 'e-2' },
            { organizationId: 'org-1' },
            { organizationId: 'org-1', phone: '010-0000-0000' },
        );
        expect(lastEntry().changedFields).toEqual(['phone']);

        await fireUpdate(USER, { userId: 'e-3' },
            { organizationId: 'org-1', phone: '010-0000-0000' },
            { organizationId: 'org-1' },
        );
        expect(lastEntry().changedFields).toEqual(['phone']);
    });

    it('직렬화할 수 없는 값이 들어와도 핸들러가 죽지 않는다', async () => {
        // 순환 참조가 있으면 JSON.stringify가 throw한다. retry가 켜져 있으므로 핸들러가
        // reject되면 이벤트가 무한 재시도되거나 폐기된다 — 변경으로 처리하고 넘어간다.
        const circular: Record<string, unknown> = { organizationId: 'org-1' };
        circular.notes = circular;

        await expect(
            fireUpdate(DRIVE_LOG, { logId: 'e-4' }, { organizationId: 'org-1', notes: 'x' }, circular)
        ).resolves.toBeUndefined();
        expect(lastEntry().changedFields).toEqual(['notes']);
    });
});
