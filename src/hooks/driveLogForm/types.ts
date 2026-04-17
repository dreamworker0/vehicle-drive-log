/**
 * driveLogForm/types.ts
 * useDriveLogForm 관련 공유 타입 정의
 */
import type { DriveLog } from '../../types/driveLog';

export interface DriveLogForm {
    vehicleId: string;
    vehicleName: string;
    purpose: string;
    destination: string;
    startTime: string;
    endTime: string;
    startKm: string;
    endKm: string;
    batteryStart: string;
    batteryEnd: string;
    notes: string;
    driveDate: string;
    hipassBalanceAfter: string;
}

export interface LocationState {
    reservationId?: string;
    vehicleId?: string;
    vehicleName?: string;
    purpose?: string;
    destination?: string;
    actualStartTime?: string;
    currentKm?: number;
    editLog?: DriveLog & { passengerNames?: string[] };
}
