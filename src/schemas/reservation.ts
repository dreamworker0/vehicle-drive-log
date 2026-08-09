import { z } from 'zod';
import { timestampSchema } from './common';

/**
 * 예약 상태.
 *
 * 예전에는 `z.custom<ReservationStatus>()`였다 — 검증 함수가 없는 `z.custom`은
 * **무엇이든 통과시키므로** 폴백(`.catch('pending')`)이 한 번도 동작하지 않았고,
 * 타입은 유니온이라고 선언하면서 실제로는 임의 문자열이 들어올 수 있었다.
 * 실제 쓰기 지점(앱·Functions·캘린더 동기화)이 쓰는 값은 아래가 전부다.
 *
 * 폴백을 `'reserved'`로 둔 이유: 알 수 없는 값은 손상된 문서라는 뜻인데, 이때
 * 가장 덜 위험한 해석은 "그 시간대는 이미 잡혀 있다"이다. `'cancelled'`로 떨어뜨리면
 * 화면에서 사라져 같은 차량이 이중 배차된다.
 */
export const reservationStatusSchema = z.enum([
    'pending', 'reserved', 'in_use', 'in_progress', 'completed', 'cancelled', 'rejected',
]);

export const reservationSchema = z.object({
    organizationId: z.string().catch(''),
    vehicleId: z.string().catch(''),
    vehicleName: z.string().optional().catch(undefined),
    vehicleDisplayName: z.string().optional().catch(undefined),
    /** 'YYYY-MM-DD' */
    date: z.string().catch(''),
    /** 'HH:MM' */
    startTime: z.string().catch(''),
    /** 'HH:MM' */
    endTime: z.string().catch(''),
    actualStartTime: z.string().optional().catch(undefined),
    actualEndTime: z.string().optional().catch(undefined),
    /** 출발 시점의 차량 누적 거리 — 운행일지 초기값으로 넘어간다 */
    currentKm: z.coerce.number().optional().catch(undefined),
    purpose: z.string().optional().catch(undefined),
    destination: z.string().optional().catch(undefined),
    reservedByUid: z.string().catch(''),
    reservedByName: z.string().optional().catch(undefined),
    status: reservationStatusSchema.catch('reserved'),
    rejectedReason: z.string().optional().catch(undefined),
    /** 반려 처리 시각 */
    rejectedAt: timestampSchema.optional().catch(undefined),
    routeDistance: z.coerce.number().nullable().optional().catch(null),
    routeDuration: z.coerce.number().nullable().optional().catch(null),
    routeTollFee: z.coerce.number().nullable().optional().catch(null),
    /** 다일 연속 예약 그룹 식별자 */
    groupId: z.string().optional().catch(undefined),
    /** 반복(정기) 예약 그룹 식별자 */
    recurringGroupId: z.string().optional().catch(undefined),
    /**
     * 예약 시점에 미리 적어 두는 동승자 — **예정이지 기록이 아니다.**
     * 확정 기록은 운행일지(`driveLogs.passengerNames`)이며 통계·감사는 그쪽만 본다.
     * 여기 값은 운행일지 작성 화면을 열 때 초기값으로 채워지고, 거기서 자유롭게 고칠 수 있다.
     *
     * uid와 이름을 함께 남기는 이유: uid는 동명이인·개명에도 정확히 복원하기 위해,
     * 이름은 퇴사·계정 삭제 뒤에도 "누가 타기로 했었는지"가 사라지지 않게 하기 위해.
     */
    passengerUids: z.array(z.string()).optional().catch(undefined),
    passengerNames: z.array(z.string()).optional().catch(undefined),
    /** 조직원이 아닌 외부 동승 인원 수 (이름 없이 숫자만) */
    passengerCount: z.coerce.number().optional().catch(undefined),
    /** 바로 운행(예약 없이 출발) 여부 플래그 */
    isQuickDrive: z.boolean().optional().catch(undefined),
    /** 예약 출처 (예: 'recommendation' — 추천 예약) */
    source: z.string().optional().catch(undefined),
    /** 예약 동기화 출처 (예: 'calendar'). 예약 목록의 📅 배지가 읽는다 */
    syncSource: z.string().optional().catch(undefined),
    /** 연결된 Google 캘린더 이벤트 id — 캘린더 동기화(Functions)가 심는다 */
    calendarEventId: z.string().optional().catch(undefined),
    createdAt: timestampSchema.optional().catch(undefined),
    expiresAt: timestampSchema.optional().catch(undefined),
});
