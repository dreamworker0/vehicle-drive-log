/**
 * 차량 (Vehicles) 타입 정의
 */
import type { FirestoreDoc, TimestampField } from './common';

export type VehicleType = 'compact' | 'sedan' | 'van' | 'bus' | 'truck';

export type FuelType = 'gasoline' | 'diesel' | 'lpg' | 'electric' | 'hydrogen';
export const FUEL_TYPES: { id: FuelType; label: string }[] = [
    { id: 'gasoline', label: '가솔린' },
    { id: 'diesel', label: '디젤' },
    { id: 'lpg', label: 'LPG' },
    { id: 'electric', label: '전기' },
    { id: 'hydrogen', label: '수소' }
];

export interface VehicleRetired {
    isRetired: boolean;
    reason: string;
    retiredAt: TimestampField;
}

export interface VehicleMaintenance {
    isBlocked: boolean;
    reason: string;
    endDate: string | null;
    recordId: string;
    blockedAt: TimestampField;
}

export interface Vehicle extends FirestoreDoc {
    organizationId: string;
    name: string;
    displayName?: string;
    modelName?: string;
    plateNumber: string;
    type: VehicleType;
    vehicleType?: string;
    fuelType?: FuelType;
    currentKm: number;
    insurance?: {
        company: string;
        phone: string;
    };
    hipassCardNumber?: string;
    googleCalendarId?: string;
    calendarSyncFailCount?: number;
    calendarSyncLastFailAt?: TimestampField;
    retired?: VehicleRetired | null;
    maintenance?: VehicleMaintenance | null;
    createdAt?: TimestampField;
}

/** createVehicle에 전달할 데이터 */
export type CreateVehicleData = Omit<Vehicle, 'id' | 'createdAt' | 'retired' | 'maintenance'>;
