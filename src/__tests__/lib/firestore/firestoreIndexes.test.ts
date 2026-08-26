/**
 * firestore.indexes.json 회귀 가드
 *
 * 이 파일의 인덱스가 빠지면 화면은 "The query requires an index"로 실패하는데,
 * 인덱스 배포는 `--force` 없이는 프로덕션에서 삭제하지 않아 **파일에서 사라져도 한동안
 * 증상이 없다.** 그래서 조용히 유실됐다가 나중에 새 프로젝트·재배포 시점에 터진다
 * (#176 유실 → #193 복원, Sentry JAVASCRIPT-REACT-5F).
 *
 * 여기서는 "동등 필터 + 범위 필터" 조합이라 반드시 복합 인덱스가 필요한 쿼리만 고정한다.
 * 동등 필터만 있는 쿼리는 단일 필드 인덱스 병합으로 처리되므로 대상이 아니다.
 */
import indexConfig from '../../../../firestore.indexes.json';

interface IndexField { fieldPath: string; order?: string; arrayConfig?: string }
interface CompositeIndex { collectionGroup: string; queryScope?: string; fields: IndexField[] }

const indexes = indexConfig.indexes as CompositeIndex[];

/** 해당 컬렉션에 이 필드 순서로 시작하는 인덱스가 있는가 (__name__ 등 뒤쪽 필드는 무시) */
const hasIndex = (collectionGroup: string, fieldPaths: string[]): boolean =>
    indexes.some((index) =>
        index.collectionGroup === collectionGroup
        && fieldPaths.every((path, i) => index.fields[i]?.fieldPath === path));

describe('firestore.indexes.json — 복합 인덱스 필수 쿼리', () => {
    // src/lib/firestore/maintenance.ts — cancelVehicleReservations
    // 없으면 정비 차단·폐차에서 예약 일괄 취소가 통째로 실패한다(정비 기록만 남고 예약은 그대로).
    it('정비 차단 시 예약 일괄 취소: reservations (organizationId, vehicleId, status, date)', () => {
        expect(hasIndex('reservations', ['organizationId', 'vehicleId', 'status', 'date'])).toBe(true);
    });

    // src/lib/firestore/reservations.ts — getWeekReservations · getReservations(기간)
    it('기간별 예약 조회: reservations (organizationId, date)', () => {
        expect(hasIndex('reservations', ['organizationId', 'date'])).toBe(true);
    });

    // src/lib/firestore/reservations.ts — getMyRecentReservations
    it('내 최근 예약 조회: reservations (organizationId, reservedByUid, date)', () => {
        expect(hasIndex('reservations', ['organizationId', 'reservedByUid', 'date'])).toBe(true);
    });

    // src/lib/firestore/auditLogs.ts — 유형 필터가 요구한 조합 (#176에서 유실됐던 인덱스)
    it('접속기록 유형 필터: auditLogs (action, organizationId, at)', () => {
        expect(hasIndex('auditLogs', ['action', 'organizationId', 'at'])).toBe(true);
    });
});
