/**
 * 주유 기록 (Fuel Logs) 타입 정의
 */
import type { FirestoreDoc, TimestampField } from './common';

export interface FuelLog extends FirestoreDoc {
    organizationId: string;
    vehicleId: string;
    vehicleName?: string;
    driverUid: string;
    driverName?: string;
    date: string;              // 'YYYY-MM-DD'
    meterReading: number;      // 주유 시 계기판 km
    meterPhotoUrl?: string;    // 계기판 촬영 사진 URL
    fuelType?: 'gasoline' | 'electric';  // 연료 유형 (미지정 시 gasoline 취급)
    fuelAmount: number;        // 주유량 (리터) 또는 충전량 (kWh)
    fuelCost: number;          // 주유 금액 또는 충전 금액 (원)
    notes?: string;            // 비고 (선택)
    createdAt?: TimestampField;
}

/** createFuelLog에 전달할 데이터 */
export type CreateFuelLogData = Omit<FuelLog, 'id' | 'createdAt'>;
