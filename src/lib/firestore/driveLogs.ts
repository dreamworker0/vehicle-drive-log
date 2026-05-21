/**
 * driveLogs.ts — Proxy Re-export
 * 이 파일은 src/lib/firestore/driveLogs/ 폴더로 분해된 모듈들을 기존 인터페이스를 유지한 채 재수출합니다.
 * 기존 코드의 import 경로(`@/lib/firestore/driveLogs`) 변경 없이 리팩토링 효과를 얻을 수 있습니다.
 * 실제 로직은 src/lib/firestore/driveLogs/ 내부 파일을 수정하세요.
 */
export { createDriveLog, updateDriveLog, deleteDriveLog } from './driveLogs/mutations';

export {
    getDriveLogs,
    getAllDriveLogsForExport,
    getMyDriveLogs,
    getVehicleDriveLogs,
    hasVehicleDriveLogs,
} from './driveLogs/queries';

export {
    sanitizeUndefined,
    hasLaterDriveLog,
    getLastVehicleEndKm,
    getLastVehicleDriveLog,
    getLastVehicleEndBattery,
    getVehicleEndKmBefore,
    syncNextLogStartKm,
    cleanupDuplicateLogs,
    getAdjacentDriveLogs,
} from './driveLogs/utils';

export type { AggregatedStats } from './driveLogs/stats';
export { getDriveLogCount, getDriveLogAggregatedStats } from './driveLogs/stats';
