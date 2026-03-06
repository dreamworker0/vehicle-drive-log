/**
 * 차량 정비 (Maintenance) 타입 정의
 */
import type { FirestoreDoc, TimestampField } from './common';

export interface MaintenanceRecord extends FirestoreDoc {
    organizationId: string;
    vehicleId: string;
    vehicleName?: string;
    type: string;
    description?: string;
    cost?: number;
    shop?: string;
    km?: number;
    nextDueKm?: number;
    nextDueDate?: string;
    date: string;              // 'YYYY-MM-DD'
    blockVehicle: boolean;
    blockEndDate: string | null;
    createdAt?: TimestampField;
}

/** createMaintenanceRecord에 전달할 데이터 */
export type CreateMaintenanceData = Omit<MaintenanceRecord, 'id' | 'createdAt'>;
