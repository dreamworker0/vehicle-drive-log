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
    rejectedAt?: TimestampField;  // 반려 처리 시각
    routeDistance?: number | null;
    routeDuration?: number | null;
    routeTollFee?: number | null;
    groupId?: string;            // 다일 연속 예약 그룹 식별자
    recurringGroupId?: string;   // 반복(정기) 예약 그룹 식별자
    /**
     * 예약 시점에 미리 적어 두는 동승자 — **예정이지 기록이 아니다.**
     * 확정 기록은 운행일지(`driveLogs.passengerNames`)이며 통계·감사는 그쪽만 본다.
     * 여기 값은 운행일지 작성 화면을 열 때 초기값으로 채워지고, 거기서 자유롭게 고칠 수 있다.
     *
     * uid와 이름을 함께 남기는 이유: uid는 동명이인·개명에도 정확히 복원하기 위해,
     * 이름은 퇴사·계정 삭제 뒤에도 "누가 타기로 했었는지"가 사라지지 않게 하기 위해.
     */
    passengerUids?: string[];
    passengerNames?: string[];
    /** 조직원이 아닌 외부 동승 인원 수 (이름 없이 숫자만) */
    passengerCount?: number;
    isQuickDrive?: boolean;      // 바로 운행(예약 없이 출발) 여부 플래그
    source?: 'recommendation' | string; // 예약 출처 (예: 추천 예약)
    syncSource?: string;         // 예약 동기화 출처 (예: 'calendar')
    createdAt?: TimestampField;
    expiresAt?: Date | TimestampField;
}

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
