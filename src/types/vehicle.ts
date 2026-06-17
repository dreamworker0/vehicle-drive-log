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
    currentBattery?: number;        // 전기차 배터리 잔량 (%)
    insurance?: {
        company: string;
        phone: string;
        expiryDate?: string;          // 보험 만료일 (YYYY-MM-DD, 선택)
    };
    insuranceExpiryNotifiedFor?: string; // 야간 배치가 마지막으로 만료 알림을 보낸 만료일 (멱등성 마커, 백엔드 전용)
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
