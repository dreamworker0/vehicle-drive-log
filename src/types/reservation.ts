/**
 * 차량 예약 (Reservations) 타입 정의
 */
import type { FirestoreDoc, TimestampField } from './common';

export type ReservationStatus = 'pending' | 'reserved' | 'in_use' | 'in_progress' | 'completed' | 'cancelled' | 'rejected';

export interface Reservation extends FirestoreDoc {
    organizationId: string;
    vehicleId: string;
    vehicleName?: string;
    vehicleDisplayName?: string;
    date: string;               // 'YYYY-MM-DD'
    startTime: string;           // 'HH:MM'
    endTime: string;             // 'HH:MM'
    actualStartTime?: string;
    actualEndTime?: string;
    currentKm?: number;
    purpose?: string;
    destination?: string;
    reservedByUid: string;
    reservedByName?: string;
    status: ReservationStatus;
    rejectedReason?: string;
    routeDistance?: number | null;
    routeDuration?: number | null;
    routeTollFee?: number | null;
    groupId?: string;            // 다일 연속 예약 그룹 식별자
    recurringGroupId?: string;   // 반복(정기) 예약 그룹 식별자
    isQuickDrive?: boolean;      // 바로 운행(예약 없이 출발) 여부 플래그
    source?: 'recommendation' | string; // 예약 출처 (예: 추천 예약)
    syncSource?: string;         // 예약 동기화 출처 (예: 'calendar')
    createdAt?: TimestampField;
    expiresAt?: Date | TimestampField;
}

/** 예약 폼 상태 (ReservationSidePanel / useReservationCalendar 공용) */
export interface ReservationForm {
    vehicleId: string;
    destination: string;
    purpose: string;
    startTime: string;
    endTime: string;
    endDate?: string;
    reservedByUid?: string;
    reservedByName?: string;
    // 반복 예약 필드
    isRecurring?: boolean;
    recurringDays?: number[];
    recurringStartDate?: string;
    recurringEndDate?: string;
    excludeHolidays?: boolean;
    excludedDates?: string[];
}

/** createReservation에 전달할 데이터 */
export type CreateReservationData = Omit<Reservation, 'id' | 'status' | 'createdAt'>;

/** 캘린더 렌더링에 사용되는 일자별 데이터 구조 */
export interface CalendarDay {
    date: number;
    dateStr: string;
    reservations: Reservation[];
    holiday: string | null;
}
