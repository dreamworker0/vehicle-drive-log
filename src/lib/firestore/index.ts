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
    getOrganizationAdmins,
    getOrgMemberCounts,
    restoreUser,
    clearUserOrganization,
    saveUserGoogleOauth,
    getUserGoogleOauth,
    clearUserGoogleOauth,
} from './users';

// 사전 등록 직원 (Pre-registered Employees)
export {
    getPreRegisteredEmployees,
    addPreRegisteredEmployee,
    deletePreRegisteredEmployee,
} from './preRegistered';

// 기관 (Organizations)
export {
    createOrganization,
    getOrganization,
    updateOrganization,
    deleteOrganization,
    permanentDeleteOrganization,
    restoreOrganization,
    getPendingOrganizations,
    getRejectedOrganizations,
    getDeletedOrganizations,
    getApprovedOrganizations,
    approveOrganization,
    approveOrganizationWithAdmins,
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
    getLastVehicleDriveLog,
    getLastVehicleEndBattery,
    getVehicleEndKmBefore,
    getDriveLogs,
    getDriveLogCount,
    getAllDriveLogsForExport,
    getMyDriveLogs,
    updateDriveLog,
    getVehicleDriveLogs,
    hasVehicleDriveLogs,
    cleanupDuplicateLogs,
    syncNextLogStartKm,
    deleteDriveLog,
    getAdjacentDriveLogs,
} from './driveLogs';

// 차량 예약 (Reservations)
export {
    createReservation,
    createReservationSafe,
    getReservations,
    getReservationById,
    getReservationByIdAndOrg,
    cancelReservation,
    updateReservation,
    updateReservationStatus,
    rejectReservation,
    getTodayReservations,
    getWeekReservations,
    getReservationsByDateRange,
    getReservationsByGroupId,
    cancelReservationGroup,
    deleteReservationGroup,
    getReservationsByRecurringGroupId,
    cancelRecurringGroup,
    deleteRecurringGroup,
} from './reservations';

// 알림 (Notifications)
export {
    createNotification,
    getNotifications,
    markNotificationRead,
    subscribeNotifications,
    deleteNotification,
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
    updateMaintenanceRecord,
    deleteMaintenanceRecord,
    clearVehicleMaintenanceBlock,
    cancelVehicleReservations,
} from './maintenance';

// 피드백 (Feedbacks)
export {
    createFeedback,
    getAllFeedbacks,
    updateFeedback,
    deleteFeedback,
} from './feedbacks';

// 주유 기록 (Fuel Logs)
export {
    getFuelLogs,
    createFuelLog,
    deleteFuelLog,
    updateFuelLog,
} from './fuelLogs';

// 슈퍼관리자 관리
export {
    getSuperAdmins,
    getUserByEmail,
    addSuperAdmin,
    removeSuperAdmin,
} from './superAdmin';

// 일별일지 쿼리 (Daily Log Queries)
export {
    getDriveLogsByDate,
    getFuelLogsByDate,
    getPreviousDayEndKm,
} from './dailyLogQueries';

// 하이패스 카드 (Hipass Cards)
export {
    getHipassCards,
    createHipassCard,
    updateHipassCard,
    deleteHipassCard,
} from './hipass';

// 하이패스 충전 기록 (Hipass Charges)
export {
    getAllHipassCharges,
    getHipassCharges,
    createHipassCharge,
    deleteHipassCharge,
} from './hipassCharges';
