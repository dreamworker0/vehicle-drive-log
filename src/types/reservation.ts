/**
 * 차량 예약 (Reservations) 타입 정의
 */
import type { FirestoreDoc, TimestampField } from './common';

export type ReservationStatus = 'reserved' | 'in_use' | 'in_progress' | 'completed' | 'cancelled';

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
    purpose?: string;
    destination?: string;
    reservedByUid: string;
    reservedByName?: string;
    status: ReservationStatus;
    routeDistance?: number | null;
    routeDuration?: number | null;
    routeTollFee?: number | null;
    groupId?: string;            // 다일 연속 예약 그룹 식별자
    createdAt?: TimestampField;
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
