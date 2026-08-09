/**
 * 차량 예약 (Reservations) 타입
 *
 * 문서 모양의 원본은 `src/schemas/reservation.ts`다 — 여기서는 파생만 한다.
 * 아래 폼·캘린더 타입은 Firestore 문서가 아니라 화면 상태라 여기에 둔다.
 */
import type { z } from 'zod';
import type { reservationSchema, reservationStatusSchema } from '../schemas/reservation';
import type { FirestoreDoc } from './common';

export type ReservationStatus = z.infer<typeof reservationStatusSchema>;

export type Reservation = z.infer<typeof reservationSchema> & FirestoreDoc;

/**
 * 동승자 입력 필드 묶음 — **예약 폼과 바로 운행 폼이 함께 쓴다.**
 *
 * 두 화면의 폼 상태 모양은 서로 다르지만(예약은 날짜·반복까지, 바로 운행은 차량·목적지뿐)
 * 동승자 부분만은 같은 규칙으로 조립·복원되어야 한다. 그래서 이 세 필드를 따로 떼어
 * `composeReservationPassengers`·동승자 입력 컴포넌트가 이 타입만 보게 한다.
 */
export interface PassengerFormValues {
    /** 선택된 조직원 uid */
    passengerUids?: string[];
    /**
     * 직접 입력한 이름들의 **원문**(쉼표 구분). 배열이 아니라 문자열인 이유는
     * 입력 중인 "홍길동, " 같은 중간 상태를 그대로 보존해야 하기 때문 —
     * 매 입력마다 배열로 쪼갰다 합치면 커서와 쉼표가 튄다.
     * 저장 시점에만 `Reservation.passengerNames`로 합쳐진다.
     */
    passengerExternalNames?: string;
    /** 이름 없이 숫자만 세는 외부 인원 */
    passengerCount?: number;
}

/** 예약 폼 상태 (ReservationSidePanel / useReservationCalendar 공용) */
export interface ReservationForm extends PassengerFormValues {
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
    // 동승자(예정) 필드는 PassengerFormValues에서 상속 —
    // 기관 설정 reservationPassengerEnabled가 켜진 기관에서만 입력받는다.
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
