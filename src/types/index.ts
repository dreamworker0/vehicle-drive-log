/**
 * 도메인 타입 통합 re-export
 *
 * 사용법: import type { User, Vehicle, DriveLog } from '../types';
 */

export type { FirestoreTimestamp, TimestampField, FirestoreDoc } from './common';
export type { User, UserRole, CreateUserData } from './user';
export type { Vehicle, VehicleType, VehicleRetired, VehicleMaintenance, CreateVehicleData } from './vehicle';
export type { DriveLog, CreateDriveLogData, DriveLogPage, SyncResult, DriveLogFilters } from './driveLog';
export type { Reservation, ReservationStatus, CreateReservationData } from './reservation';
export type { Organization, OrgStatus, CreateOrgData } from './organization';
export type { Notification } from './notification';
export type { MaintenanceRecord, CreateMaintenanceData } from './maintenance';
export type { Favorite } from './favorite';
export type { CustomHoliday } from './holiday';
export type { Feedback, FeedbackStatus } from './feedback';
export type { FuelLog, CreateFuelLogData } from './fuelLog';
