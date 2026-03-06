/**
 * 차량 (Vehicles) 타입 정의
 */
import type { FirestoreDoc, TimestampField } from './common';

export type VehicleType = 'compact' | 'sedan' | 'van' | 'bus';

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
    fuelType?: string;
    currentKm: number;
    insurance?: {
        company: string;
        phone: string;
    };
    googleCalendarId?: string;
    retired?: VehicleRetired | null;
    maintenance?: VehicleMaintenance | null;
    createdAt?: TimestampField;
}

/** createVehicle에 전달할 데이터 */
export type CreateVehicleData = Omit<Vehicle, 'id' | 'createdAt' | 'retired' | 'maintenance'>;
