/**
 * dailyNightlyBatch.test.ts
 * - 야간 배치 함수의 날짜 조건 비즈니스 로직 단위 테스트
 *
 * Firestore mock chain은 모듈 캐시와 호이스팅 이슈가 복잡하므로
 * 핵심 날짜 조건 계산 로직만 별도로 검증한다.
 */
// 모듈 로드 시 초기화되는 외부 의존성만 차단하고, 순수 함수(buildBackupUri)를 그대로 가져온다.
jest.mock('firebase-admin/firestore', () => ({ getFirestore: jest.fn() }));
jest.mock('firebase-admin/storage', () => ({ getStorage: jest.fn() }));
jest.mock('firebase-functions/v2/scheduler', () => ({
    onSchedule: (_opts: unknown, handler: Function) => handler,
}));
jest.mock('../utils/helpers', () => ({ log: jest.fn() }));
jest.mock('../handlers/scheduled/dailyAggregation', () => ({ runDailyAggregation: jest.fn() }));
jest.mock('../services/statistics/computeDashboardStats', () => ({ computeAllDashboardStats: jest.fn() }));
jest.mock('../services/alimtalk/sendNotification', () => ({
    createInAppNotification: jest.fn(),
    sendPushToUser: jest.fn(),
}));
jest.mock('../core/sentry', () => ({ captureError: jest.fn(), captureWarning: jest.fn() }));
// export 호출 자체를 검증해야 하므로 Admin 클라이언트를 통째로 갈아 끼운다.
jest.mock('@google-cloud/firestore', () => {
    const exportDocuments = jest.fn();
    class FirestoreAdminClient {
        databasePath(projectId: string, database: string) {
            return `projects/${projectId}/databases/${database}`;
        }
        exportDocuments = exportDocuments;
    }
    return { v1: { FirestoreAdminClient }, __exportDocuments: exportDocuments };
});

import { getStorage } from 'firebase-admin/storage';
import { captureWarning } from '../core/sentry';
import {
    buildBackupUri,
    buildBackupPrefix,
    resolveBackupBucket,
    describeExportFailure,
    isPathAlreadyExists,
    backupFirestoreData,
    buildCompletionMarker,
    previousKstDateString,
    classifyBackupState,
    describeBackupGap,
    verifyPreviousBackup,
} from '../handlers/scheduled/dailyNightlyBatch';
import { getKSTDateString } from '../utils/kstDate';

const { __exportDocuments: exportDocumentsMock } =
    jest.requireMock('@google-cloud/firestore') as { __exportDocuments: jest.Mock };

describe('resolveBackupBucket — 백업 전용 버킷 선택', () => {
    const original = process.env.FIRESTORE_BACKUP_BUCKET;
    afterEach(() => {
        if (original === undefined) delete process.env.FIRESTORE_BACKUP_BUCKET;
        else process.env.FIRESTORE_BACKUP_BUCKET = original;
    });

    it('환경변수가 없으면 {projectId}-backups를 쓴다', () => {
        delete process.env.FIRESTORE_BACKUP_BUCKET;
        expect(resolveBackupBucket('vehicle-drive-log')).toBe('vehicle-drive-log-backups');
    });

    it('환경변수로 덮어쓸 수 있다', () => {
        process.env.FIRESTORE_BACKUP_BUCKET = 'custom-backup-bucket';
        expect(resolveBackupBucket('vehicle-drive-log')).toBe('custom-backup-bucket');
    });

    it('기본 버킷(.firebasestorage.app)을 절대 쓰지 않는다 — us-east1이라 export 대상이 될 수 없다', () => {
        delete process.env.FIRESTORE_BACKUP_BUCKET;
        expect(resolveBackupBucket('vehicle-drive-log')).not.toContain('firebasestorage.app');
        expect(resolveBackupBucket('vehicle-drive-log')).not.toContain('appspot.com');
    });
});

describe('buildBackupUri — 백업 대상 GCS 경로', () => {
    it('전달받은 버킷 이름을 그대로 쓴다', () => {
        expect(buildBackupUri('vehicle-drive-log.firebasestorage.app', '2026-08-09'))
            .toBe('gs://vehicle-drive-log.firebasestorage.app/backups/firestore/2026-08-09');
    });

    it('.appspot.com을 하드코딩하지 않는다 (없는 버킷 → PERMISSION_DENIED 회귀 방지)', () => {
        expect(buildBackupUri('vehicle-drive-log.firebasestorage.app', '2026-08-09'))
            .not.toContain('appspot.com');
    });

    it('레거시 .appspot.com 기본 버킷 프로젝트도 그대로 지원한다', () => {
        expect(buildBackupUri('legacy-project.appspot.com', '2026-08-09'))
            .toBe('gs://legacy-project.appspot.com/backups/firestore/2026-08-09');
    });

    it('OPERATIONS.md가 안내하는 backups/firestore/YYYY-MM-DD 구조를 유지한다', () => {
        expect(buildBackupUri('b', '2026-01-02')).toMatch(/\/backups\/firestore\/\d{4}-\d{2}-\d{2}$/);
    });

    it('존재 확인용 접두사는 export 대상과 같은 경로 + 끝 슬래시다 (다른 날짜가 섞이지 않게)', () => {
        expect(buildBackupPrefix('2026-08-15')).toBe('backups/firestore/2026-08-15/');
        expect(buildBackupUri('b', '2026-08-15')).toBe(`gs://b/backups/firestore/2026-08-15`);
    });
});

describe('isPathAlreadyExists — 같은 날 두 번째 실행 판별', () => {
    it('export가 거절한 "Path already exists"를 알아본다', () => {
        const e = Object.assign(
            new Error('3 INVALID_ARGUMENT: Path already exists: /vehicle-drive-log-backups/backups/firestore/2026-08-15/2026-08-15.overall_export_metadata'),
            { code: 3 }
        );
        expect(isPathAlreadyExists(e)).toBe(true);
    });

    it('권한·위치 실패는 "이미 있음"으로 삼키지 않는다', () => {
        expect(isPathAlreadyExists(new Error('7 PERMISSION_DENIED: The caller does not have permission'))).toBe(false);
        expect(isPathAlreadyExists(new Error('Bucket x is in location us-east1.'))).toBe(false);
        expect(isPathAlreadyExists(null)).toBe(false);
    });
});

describe('backupFirestoreData — 하루 한 번만 export를 건다', () => {
    const originalProject = process.env.GCLOUD_PROJECT;

    /** 백업 버킷 스텁. files는 오늘 접두사 아래에 이미 있는 객체 목록. */
    function stubBucket({ exists = true, files = [] as unknown[] } = {}) {
        const bucket = {
            exists: jest.fn().mockResolvedValue([exists]),
            getFiles: jest.fn().mockResolvedValue([files]),
        };
        (getStorage as jest.Mock).mockReturnValue({ bucket: jest.fn().mockReturnValue(bucket) });
        return bucket;
    }

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.GCLOUD_PROJECT = 'vehicle-drive-log';
        delete process.env.FIRESTORE_BACKUP_BUCKET;
        exportDocumentsMock.mockResolvedValue([{ name: 'operations/abc' }]);
    });

    afterAll(() => {
        if (originalProject === undefined) delete process.env.GCLOUD_PROJECT;
        else process.env.GCLOUD_PROJECT = originalProject;
    });

    it('오늘 백업이 없으면 오늘 날짜 경로로 export를 건다', async () => {
        const bucket = stubBucket({ files: [] });

        await backupFirestoreData();

        expect(bucket.getFiles).toHaveBeenCalledWith({ prefix: buildBackupPrefix(getKSTDateString()), maxResults: 1 });
        expect(exportDocumentsMock).toHaveBeenCalledTimes(1);
        expect(exportDocumentsMock.mock.calls[0][0]).toMatchObject({
            outputUriPrefix: buildBackupUri('vehicle-drive-log-backups', getKSTDateString()),
            collectionIds: [],
        });
    });

    it('오늘 폴더에 이미 객체가 있으면 export를 걸지 않는다 — 중복 사본은 읽기 비용만 두 배다', async () => {
        stubBucket({ files: [{ name: 'backups/firestore/2026-08-15/output-0' }] });

        await expect(backupFirestoreData()).resolves.toBeUndefined();
        expect(exportDocumentsMock).not.toHaveBeenCalled();
    });

    // OOM·타임아웃은 인스턴스를 죽여 스스로를 신고하지 못한다. 스킵 경고가 유일한 탐지 수단이므로
    // 이 두 케이스는 "조용히 넘어가지 않는다"를 못박아 둔다 — 지워지면 다음 OOM은 아무도 모른다.
    it('스킵을 조용히 넘기지 않고 경고로 올린다 — 배치가 두 번 돌았다는 신호다', async () => {
        stubBucket({ files: [{ name: 'backups/firestore/2026-08-15/output-0' }] });

        await backupFirestoreData();

        expect(captureWarning).toHaveBeenCalledTimes(1);
        const [message, ctx] = (captureWarning as jest.Mock).mock.calls[0];
        expect(message).toContain('같은 날 두 번 실행');
        expect(ctx).toMatchObject({ context: 'dailyNightlyBatch', step: 'backupFirestore' });
        // 받는 사람이 바로 로그를 열 수 있도록 조사 지점을 싣는다
        expect(JSON.stringify(ctx)).toContain('Memory limit');
    });

    it('경합으로 스킵한 경우에도 경고를 올린다', async () => {
        stubBucket({ files: [] });
        exportDocumentsMock.mockRejectedValue(
            Object.assign(new Error('3 INVALID_ARGUMENT: Path already exists: /b/backups/firestore/2026-08-15/2026-08-15.overall_export_metadata'), { code: 3 })
        );

        await backupFirestoreData();

        expect(captureWarning).toHaveBeenCalledTimes(1);
    });

    it('정상 백업에는 경고를 내지 않는다 — 매일 뜨면 이 채널도 무뎌진다', async () => {
        stubBucket({ files: [] });

        await backupFirestoreData();

        expect(captureWarning).not.toHaveBeenCalled();
    });

    it('사전 확인을 통과한 뒤 경합으로 "Path already exists"가 나도 실패로 올리지 않는다', async () => {
        stubBucket({ files: [] });
        exportDocumentsMock.mockRejectedValue(
            Object.assign(new Error('3 INVALID_ARGUMENT: Path already exists: /b/backups/firestore/2026-08-15/2026-08-15.overall_export_metadata'), { code: 3 })
        );

        await expect(backupFirestoreData()).resolves.toBeUndefined();
    });

    it('진짜 실패(IAM)는 그대로 올린다 — 알림이 사라지면 안 된다', async () => {
        stubBucket({ files: [] });
        exportDocumentsMock.mockRejectedValue(
            Object.assign(new Error('7 PERMISSION_DENIED: The caller does not have permission'), { code: 7 })
        );

        await expect(backupFirestoreData()).rejects.toThrow('남는 원인은 IAM뿐이다');
    });

    it('존재 확인이 실패해도 백업은 포기하지 않는다 — 중복 방지는 편의, 백업이 본론이다', async () => {
        const bucket = stubBucket({ files: [] });
        bucket.getFiles.mockRejectedValue(new Error('403 does not have storage.objects.list access'));

        await expect(backupFirestoreData()).resolves.toBeUndefined();
        expect(exportDocumentsMock).toHaveBeenCalledTimes(1);
    });

    it('버킷 자체가 없으면 export 전에 명시적으로 실패한다', async () => {
        stubBucket({ exists: false });

        await expect(backupFirestoreData()).rejects.toThrow('백업 버킷 gs://vehicle-drive-log-backups 이(가) 없다');
        expect(exportDocumentsMock).not.toHaveBeenCalled();
    });
});

describe('dailyNightlyBatch — 날짜 조건 비즈니스 로직', () => {
    describe('purgeOrgs: 30일 경과 여부 판단', () => {
        function isPurgeTarget(deletedAt: Date, now: Date): boolean {
            const thirtyDaysAgo = new Date(now);
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            return deletedAt <= thirtyDaysAgo;
        }

        it('31일 전 삭제된 기관은 퍼지 대상이다', () => {
            const now = new Date('2026-01-31T00:00:00Z');
            const deletedAt = new Date('2025-12-31T00:00:00Z');
            expect(isPurgeTarget(deletedAt, now)).toBe(true);
        });

        it('정확히 30일 전 삭제된 기관은 퍼지 대상이다', () => {
            const now = new Date('2026-01-31T00:00:00Z');
            const deletedAt = new Date('2026-01-01T00:00:00Z');
            expect(isPurgeTarget(deletedAt, now)).toBe(true);
        });

        it('20일 전 삭제된 기관은 퍼지 대상이 아니다', () => {
            const now = new Date('2026-01-31T00:00:00Z');
            const deletedAt = new Date('2026-01-11T00:00:00Z');
            expect(isPurgeTarget(deletedAt, now)).toBe(false);
        });

        it('오늘 삭제된 기관은 퍼지 대상이 아니다', () => {
            const now = new Date('2026-01-31T00:00:00Z');
            const deletedAt = new Date('2026-01-31T00:00:00Z');
            expect(isPurgeTarget(deletedAt, now)).toBe(false);
        });
    });

    describe('cleanupImages: 승인 후 30일 경과 여부 판단', () => {
        function isCleanupTarget(approvedAt: Date, now: Date): boolean {
            const thirtyDaysAgo = new Date(now);
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            return approvedAt <= thirtyDaysAgo;
        }

        it('승인 후 31일 경과된 기관은 이미지 정리 대상이다', () => {
            const now = new Date('2026-01-31T00:00:00Z');
            const approvedAt = new Date('2025-12-31T00:00:00Z');
            expect(isCleanupTarget(approvedAt, now)).toBe(true);
        });

        it('승인 후 20일 경과된 기관은 이미지 정리 대상이 아니다', () => {
            const now = new Date('2026-01-31T00:00:00Z');
            const approvedAt = new Date('2026-01-11T00:00:00Z');
            expect(isCleanupTarget(approvedAt, now)).toBe(false);
        });
    });

    describe('archiveLogs: 3년 경과 여부 판단', () => {
        function isArchiveTarget(timestamp: Date, now: Date): boolean {
            const threeYearsAgo = new Date(now);
            threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
            return timestamp < threeYearsAgo;
        }

        it('3년 1개월 전 기록은 아카이빙 대상이다', () => {
            const now = new Date('2026-01-31T00:00:00Z');
            const oldLog = new Date('2022-12-31T00:00:00Z');
            expect(isArchiveTarget(oldLog, now)).toBe(true);
        });

        it('정확히 3년 전 기록은 아카이빙 대상이 아니다 (strict less than)', () => {
            const now = new Date('2026-01-31T00:00:00Z');
            const exactlyThreeYears = new Date('2023-01-31T00:00:00Z');
            expect(isArchiveTarget(exactlyThreeYears, now)).toBe(false);
        });

        it('2년 전 기록은 아카이빙 대상이 아니다', () => {
            const now = new Date('2026-01-31T00:00:00Z');
            const recentLog = new Date('2024-01-31T00:00:00Z');
            expect(isArchiveTarget(recentLog, now)).toBe(false);
        });
    });

    describe('archiveLogs: 압축률 메타데이터 계산', () => {
        it('압축률을 올바르게 계산한다', () => {
            const originalSize = 1000;
            const compressedSize = 300;
            const ratio = Math.round((1 - compressedSize / originalSize) * 100);
            expect(ratio).toBe(70); // 70% 압축
        });

        it('압축 없이 동일한 경우 0%가 된다', () => {
            const originalSize = 500;
            const compressedSize = 500;
            const ratio = Math.round((1 - compressedSize / originalSize) * 100);
            expect(ratio).toBe(0);
        });
    });

    describe('checkInsuranceExpiry: 만료일 잔여일 계산 + 알림 대상 판단', () => {
        // 프로덕션 insuranceDaysLeft / 대상 수집 조건과 동일한 순수 로직
        function daysLeft(today: string, expiry: string): number {
            return Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
        }
        interface V {
            retired?: { isRetired?: boolean };
            insurance?: { expiryDate?: string };
            insuranceExpiryNotifiedFor?: string;
        }
        function shouldNotify(v: V, days: number): boolean {
            if (v.retired?.isRetired === true) return false;
            const expiry = v.insurance?.expiryDate;
            if (!expiry) return false;
            if (days < 0 || days > 15) return false;
            if (v.insuranceExpiryNotifiedFor === expiry) return false;
            return true;
        }

        it('잔여일을 정확히 계산한다 (10일 후)', () => {
            expect(daysLeft('2026-06-17', '2026-06-27')).toBe(10);
        });

        it('15일 이내 + 미알림 차량은 알림 대상이다', () => {
            const v: V = { insurance: { expiryDate: '2026-06-27' } };
            expect(shouldNotify(v, daysLeft('2026-06-17', '2026-06-27'))).toBe(true);
        });

        it('정확히 15일 전은 알림 대상이다 (경계 포함)', () => {
            const v: V = { insurance: { expiryDate: '2026-07-02' } };
            expect(shouldNotify(v, daysLeft('2026-06-17', '2026-07-02'))).toBe(true);
        });

        it('당일(0일) 만료도 알림 대상이다', () => {
            const v: V = { insurance: { expiryDate: '2026-06-17' } };
            expect(shouldNotify(v, daysLeft('2026-06-17', '2026-06-17'))).toBe(true);
        });

        it('같은 만료일로 이미 알림을 보냈으면 스킵한다 (멱등성)', () => {
            const v: V = { insurance: { expiryDate: '2026-06-27' }, insuranceExpiryNotifiedFor: '2026-06-27' };
            expect(shouldNotify(v, daysLeft('2026-06-17', '2026-06-27'))).toBe(false);
        });

        it('만료일을 갱신해 마커와 달라지면 다시 알림 대상이다', () => {
            const v: V = { insurance: { expiryDate: '2027-06-27' }, insuranceExpiryNotifiedFor: '2026-06-27' };
            expect(shouldNotify(v, daysLeft('2027-06-17', '2027-06-27'))).toBe(true);
        });

        it('폐차 차량은 스킵한다', () => {
            const v: V = { retired: { isRetired: true }, insurance: { expiryDate: '2026-06-27' } };
            expect(shouldNotify(v, daysLeft('2026-06-17', '2026-06-27'))).toBe(false);
        });

        it('만료일이 없으면 스킵한다', () => {
            const v: V = { insurance: { expiryDate: undefined } };
            expect(shouldNotify(v, 5)).toBe(false);
        });

        it('16일 이상 남았으면 스킵한다', () => {
            const v: V = { insurance: { expiryDate: '2026-07-03' } };
            expect(shouldNotify(v, daysLeft('2026-06-17', '2026-07-03'))).toBe(false);
        });

        it('이미 만료된(음수) 차량은 스킵한다', () => {
            const v: V = { insurance: { expiryDate: '2026-06-10' } };
            expect(shouldNotify(v, daysLeft('2026-06-17', '2026-06-10'))).toBe(false);
        });
    });
});

describe('describeExportFailure — 매일 밤 나가는 알림이 조치까지 담는가', () => {
    const URI = 'gs://vehicle-drive-log-backups/backups/firestore/2026-08-11';
    const denied = Object.assign(new Error('7 PERMISSION_DENIED: The caller does not have permission'), { code: 7 });

    it('PERMISSION_DENIED면 원인을 IAM으로 특정하고 조치 명령을 싣는다', () => {
        const msg = describeExportFailure(denied, URI, 'vehicle-drive-log', 'vehicle-drive-log-backups');

        // 여기까지 온 시점에 버킷 부재·리전 불일치는 이미 배제돼 있다 — 그 판정을 메시지가 말해야 한다
        expect(msg).toContain('남는 원인은 IAM뿐이다');
        expect(msg).toContain('roles/datastore.importExportAdmin');
        expect(msg).toContain('gcp-sa-firestore.iam.gserviceaccount.com');
        expect(msg).toContain('§2.6');
    });

    it('원문 메시지와 대상 URI는 그대로 남긴다 — 진단의 출발점이다', () => {
        const msg = describeExportFailure(denied, URI, 'vehicle-drive-log', 'vehicle-drive-log-backups');
        expect(msg).toContain(`outputUriPrefix=${URI}`);
        expect(msg).toContain('The caller does not have permission');
    });

    it('메시지에 code 없이 PERMISSION_DENIED 문구만 있어도 인식한다', () => {
        const msg = describeExportFailure(new Error('PERMISSION_DENIED: nope'), URI, 'p', 'b');
        expect(msg).toContain('남는 원인은 IAM뿐이다');
    });

    it('권한 외 오류에는 추측을 덧붙이지 않는다', () => {
        const other = new Error('Bucket x is in location us-east1. This database can only operate on buckets spanning location asia');
        const msg = describeExportFailure(other, URI, 'vehicle-drive-log', 'vehicle-drive-log-backups');

        expect(msg).toContain('is in location us-east1');
        expect(msg).not.toContain('IAM');
        expect(msg).not.toContain('add-iam-policy-binding');
    });

    it('명령은 한 줄로 낸다 — PowerShell에서 bash식 줄바꿈(\\)은 파싱 에러가 된다', () => {
        // 이 서비스의 조치는 Windows PowerShell에서 이뤄진다. 알림에 담긴 명령이 그대로
        // 붙여넣기로 돌아가야 하므로 줄 끝 백슬래시를 쓰지 않는다(2026-08-10에 실제로 깨졌다).
        const msg = describeExportFailure(denied, URI, 'vehicle-drive-log', 'vehicle-drive-log-backups');

        for (const line of msg.split('\n')) {
            expect(line.trimEnd().endsWith('\\')).toBe(false);
        }
        // 각 gcloud 명령은 한 줄에 --member와 --role을 모두 갖는다
        const cmds = msg.split('\n').filter((l) => l.includes('gcloud '));
        expect(cmds).toHaveLength(2);
        for (const c of cmds) {
            expect(c).toContain('--member=');
            expect(c).toContain('--role=');
        }
    });

    it('SA 이메일을 코드에 박지 않는다 — 프로젝트 번호는 문서가 단일 원본이다', () => {
        const msg = describeExportFailure(denied, URI, 'vehicle-drive-log', 'vehicle-drive-log-backups');
        expect(msg).toContain('<projectNumber>');
        expect(msg).not.toMatch(/\d{10,}/);
    });
});

describe('classifyBackupState — 시작만 된 백업과 끝난 백업을 가른다', () => {
    const D = '2026-09-05';
    const marker = buildCompletionMarker(D);

    it('완료 표식이 있으면 complete', () => {
        expect(classifyBackupState([`backups/firestore/${D}/output-0`, marker], D)).toBe('complete');
    });

    it('출력 파일은 있는데 표식이 없으면 incomplete — 이게 지금까지 아무도 몰랐던 상태다', () => {
        // export는 장기 실행 작업이라 호출은 성공하고 나중에 실패할 수 있다.
        // 그때 폴더에는 쓰다 만 출력만 남고 표식은 끝내 쓰이지 않는다.
        expect(classifyBackupState([`backups/firestore/${D}/output-0`], D)).toBe('incomplete');
    });

    it('아무것도 없으면 missing', () => {
        expect(classifyBackupState([], D)).toBe('missing');
    });

    it('다른 날짜의 표식을 완료로 오인하지 않는다', () => {
        expect(classifyBackupState([buildCompletionMarker('2026-09-04')], D)).toBe('incomplete');
    });
});

describe('previousKstDateString', () => {
    it('KST 기준 하루 전을 돌려준다', () => {
        expect(previousKstDateString(new Date('2026-09-06T00:00:00+09:00'))).toBe('2026-09-05');
    });

    it('월 경계를 넘는다', () => {
        expect(previousKstDateString(new Date('2026-10-01T03:20:00+09:00'))).toBe('2026-09-30');
    });
});

describe('describeBackupGap — 무엇을 해야 하는지 적는다', () => {
    it('missing은 배치가 안 돈 쪽을 가리킨다', () => {
        const msg = describeBackupGap('missing', '2026-09-05', 'vehicle-drive-log-backups');
        expect(msg).toContain('2026-09-05');
        expect(msg).toContain('gs://vehicle-drive-log-backups');
        expect(msg).toContain('dailyNightlyBatch');
    });

    it('incomplete는 장기 실행 작업이 나중에 실패했을 수 있음을 알린다', () => {
        const msg = describeBackupGap('incomplete', '2026-09-05', 'b');
        expect(msg).toContain('overall_export_metadata');
        expect(msg).toContain('장기 실행');
    });
});

describe('verifyPreviousBackup — 어제 백업이 끝났는지 확인한다', () => {
    const originalProject = process.env.GCLOUD_PROJECT;
    const YESTERDAY = previousKstDateString();

    /** getFiles를 접두사별로 다르게 응답하는 버킷 스텁. */
    function stubBucketByPrefix(byPrefix: Record<string, string[]>) {
        const getFiles = jest.fn(async (opts: { prefix: string }) => {
            const names = byPrefix[opts.prefix] ?? [];
            return [names.map((name) => ({ name }))];
        });
        (getStorage as jest.Mock).mockReturnValue({ bucket: jest.fn().mockReturnValue({ getFiles }) });
        return getFiles;
    }

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.GCLOUD_PROJECT = 'vehicle-drive-log';
        delete process.env.FIRESTORE_BACKUP_BUCKET;
        jest.spyOn(console, 'warn').mockImplementation();
        jest.spyOn(console, 'log').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());
    afterAll(() => {
        if (originalProject === undefined) delete process.env.GCLOUD_PROJECT;
        else process.env.GCLOUD_PROJECT = originalProject;
    });

    it('어제 백업이 끝나 있으면 조용히 통과한다', async () => {
        stubBucketByPrefix({
            [buildBackupPrefix(YESTERDAY)]: [`backups/firestore/${YESTERDAY}/o-0`, buildCompletionMarker(YESTERDAY)],
        });

        await expect(verifyPreviousBackup()).resolves.toBeUndefined();
    });

    it('시작만 되고 끝나지 않았으면 알린다 — 지금까지 영영 몰랐던 경우다', async () => {
        stubBucketByPrefix({ [buildBackupPrefix(YESTERDAY)]: [`backups/firestore/${YESTERDAY}/o-0`] });

        await expect(verifyPreviousBackup()).rejects.toThrow('끝나지 않았다');
    });

    it('어제 백업이 통째로 없고 이력이 있으면 알린다', async () => {
        stubBucketByPrefix({
            [buildBackupPrefix(YESTERDAY)]: [],
            'backups/firestore/': ['backups/firestore/2026-01-01/o-0'],  // 이력은 있다
        });

        await expect(verifyPreviousBackup()).rejects.toThrow('백업이 없다');
    });

    it('백업 이력이 아예 없으면 헛경보를 내지 않는다 — 첫 배포 직후', async () => {
        stubBucketByPrefix({ [buildBackupPrefix(YESTERDAY)]: [], 'backups/firestore/': [] });

        await expect(verifyPreviousBackup()).resolves.toBeUndefined();
    });

    it('목록 조회가 실패하면 판정하지 않는다 — 권한 문제를 백업 부재로 단정하면 헛경보다', async () => {
        const getFiles = jest.fn().mockRejectedValue(new Error('PERMISSION_DENIED'));
        (getStorage as jest.Mock).mockReturnValue({ bucket: jest.fn().mockReturnValue({ getFiles }) });

        await expect(verifyPreviousBackup()).resolves.toBeUndefined();
    });
});
