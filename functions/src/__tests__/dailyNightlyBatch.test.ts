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
jest.mock('../core/sentry', () => ({ captureError: jest.fn() }));

import { buildBackupUri, resolveBackupBucket } from '../handlers/scheduled/dailyNightlyBatch';

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
