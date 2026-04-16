/**
 * 주유 기록 (Fuel Logs) 타입 정의
 */
import type { FirestoreDoc, TimestampField } from './common';
import type { FuelType } from './vehicle';

export interface FuelLog extends FirestoreDoc {
    [key: string]: unknown;
    organizationId: string;
    vehicleId: string;
    vehicleName?: string;
    driverUid: string;
    driverName?: string;
    date: string;              // 'YYYY-MM-DD'
    meterReading: number;      // 주유 시 계기판 km
    meterPhotoUrl?: string;    // 계기판 촬영 사진 URL
    fuelType?: FuelType;       // 연료 유형 (미지정 시 기본 시스템 정책 따름)
    fuelAmount: number;        // 주유량 (리터) 또는 충전량 (kWh/kg)
    fuelCost: number;          // 주유 금액 또는 충전 금액 (원)
    notes?: string;            // 비고 (선택)
    createdAt?: TimestampField;
}

/** createFuelLog에 전달할 데이터 */
export type CreateFuelLogData = Omit<FuelLog, 'id' | 'createdAt'>;
