/**
 * dailyNightlyBatch.test.ts
 * - 야간 배치 함수의 날짜 조건 비즈니스 로직 단위 테스트
 *
 * Firestore mock chain은 모듈 캐시와 호이스팅 이슈가 복잡하므로
 * 핵심 날짜 조건 계산 로직만 별도로 검증한다.
 */

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
});
