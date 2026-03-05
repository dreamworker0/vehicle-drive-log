/**
 * Firestore 함수 통합 re-export
 *
 * 모든 Firestore 관련 함수를 컬렉션별 모듈에서 가져와 통합 export합니다.
 * 기존 `import { ... } from '../lib/firestore'` 구문이 그대로 동작합니다.
 */

// 사용자 (Users)
export {
    getUser,
    createUser,
    leaveOrganization,
    updateUser,
    getOrganizationMembers,
} from './users';

// 기관 (Organizations)
export {
    createOrganization,
    getOrganization,
    updateOrganization,
    deleteOrganization,
    permanentDeleteOrganization,
    restoreOrganization,
    getPendingOrganizations,
    subscribePendingOrganizations,
    subscribeApprovedOrganizations,
    subscribeRejectedOrganizations,
    getRejectedOrganizations,
    getDeletedOrganizations,
    getApprovedOrganizations,
    approveOrganization,
    rejectOrganization,
    generateInviteCode,
    findOrganizationByInviteCode,
    regenerateInviteCode,
} from './organizations';

// 차량 (Vehicles)
export {
    getVehicles,
    createVehicle,
    updateVehicle,
    deleteVehicle,
    retireVehicle,
    restoreVehicle,
} from './vehicles';

// 운행일지 (Drive Logs)
export {
    createDriveLog,
    getLastVehicleEndKm,
    getVehicleEndKmBefore,
    getDriveLogs,
    getMyDriveLogs,
    updateDriveLog,
    getVehicleDriveLogs,
    cleanupDuplicateLogs,
    syncNextLogStartKm,
} from './driveLogs';

// 차량 예약 (Reservations)
export {
    createReservation,
    createReservationSafe,
    getReservations,
    subscribeReservations,
    cancelReservation,
    updateReservation,
    updateReservationStatus,
    getTodayReservations,
    getWeekReservations,
} from './reservations';

// 알림 (Notifications)
export {
    createNotification,
    getNotifications,
    markNotificationRead,
    subscribeNotifications,
} from './notifications';

// 즐겨찾기 (Favorites)
export {
    getFavorites,
    createFavorite,
    deleteFavorite,
} from './favorites';

// 커스텀 휴일 (Custom Holidays)
export {
    getCustomHolidays,
    addCustomHoliday,
    deleteCustomHoliday,
} from './holidays';

// 차량 정비 (Maintenance)
export {
    getMaintenanceRecords,
    createMaintenanceRecord,
    deleteMaintenanceRecord,
    clearVehicleMaintenanceBlock,
    cancelVehicleReservations,
} from './maintenance';

// 피드백 (Feedbacks)
export {
    createFeedback,
    getAllFeedbacks,
    updateFeedback,
    subscribeFeedbacks,
} from './feedbacks';

// 슈퍼관리자 관리
export {
    getSuperAdmins,
    getUserByEmail,
    addSuperAdmin,
    removeSuperAdmin,
} from './superAdmin';
