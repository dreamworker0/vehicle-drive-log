/**
 * driveLogForm/types.ts
 * useDriveLogForm 관련 공유 타입 정의
 */
import type { DriveLog } from '../../types/driveLog';

export interface DriveLogForm {
    vehicleId: string;
    vehicleName: string;
    /** 대표 운전자 uid. 기본값은 작성자 본인이며, 조직원 중에서 선택 가능. */
    driverUid: string;
    /** 대표 운전자 표시 이름. */
    driverName: string;
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
    /** 예약 없이 과거 누락 건을 직접 소급 입력하는 진입점 여부 */
    retroactive?: boolean;
}
