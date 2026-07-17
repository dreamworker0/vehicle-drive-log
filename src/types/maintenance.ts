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
    /** 작성자 UID — 직원이 작성한 기록의 "본인 것만 수정·삭제" 판정에 사용 (관리자 기존 기록은 없을 수 있음) */
    createdByUid?: string;
    /** 작성자 이름 (표시용) */
    createdByName?: string;
    createdAt?: TimestampField;
}

/** createMaintenanceRecord에 전달할 데이터 */
export type CreateMaintenanceData = Omit<MaintenanceRecord, 'id' | 'createdAt'>;
