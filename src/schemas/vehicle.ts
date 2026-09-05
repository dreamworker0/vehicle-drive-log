import { z } from 'zod';
import { timestampSchema } from './common';

/**
 * 차종.
 *
 * ⚠️ 이 값을 담는 `vehicle.type` 필드는 **현재 앱에서 쓰이지 않는다.** 차량 등록 폼이
 * 쓰고 목록·아이콘이 읽는 것은 아래 `vehicleType`(자유 문자열)이다. 그래서 `type`은
 * 옛 문서에만 남아 있을 수 있는 값으로 보고 optional로 둔다 — 예전 선언은 필수(required)에
 * 폴백값이 `'car'`(이 유니온에 없는 값)이라, 타입은 "항상 있다"고 말하면서 실제로는
 * 대부분 undefined인 상태였다.
 */
export const vehicleTypeSchema = z.enum(['compact', 'sedan', 'van', 'bus', 'truck']);

/** 연료·동력 유형 */
export const fuelTypeSchema = z.enum(['gasoline', 'diesel', 'lpg', 'electric', 'hydrogen']);

export const vehicleRetiredSchema = z.object({
    isRetired: z.boolean().catch(false),
    reason: z.string().catch(''),
    retiredAt: timestampSchema,
});

export const vehicleMaintenanceSchema = z.object({
    isBlocked: z.boolean().catch(false),
    reason: z.string().catch(''),
    endDate: z.string().nullable().catch(null),
    recordId: z.string().catch(''),
    blockedAt: timestampSchema,
});

export const vehicleSchema = z.object({
    organizationId: z.string().catch(''),
    name: z.string().catch(''),
    displayName: z.string().optional().catch(undefined),
    // 예전에는 `.min(1)`만 있고 `.catch()`가 없어, 모델명이 빈 옛 문서 하나가
    // **차량 문서 전체의 파싱을 실패**시켰다(Sentry [Zod] 경고 + 검증되지 않은 원시 폴백).
    // 타입 선언은 optional이었으므로 선언 쪽에 맞춘다.
    modelName: z.string().optional().catch(undefined),
    plateNumber: z.string().catch('번호 없음'),
    /** @deprecated 앱은 `vehicleType`을 쓴다 — 위 vehicleTypeSchema 주석 참고 */
    type: vehicleTypeSchema.optional().catch(undefined),
    vehicleType: z.string().optional().catch(undefined),
    fuelType: fuelTypeSchema.optional().catch(undefined),
    currentKm: z.coerce.number().catch(0),
    /** 전기차 배터리 잔량 (%) — 차량 관리 목록의 🔋 배지가 읽는다 */
    currentBattery: z.coerce.number().optional().catch(undefined),
    insurance: z.object({
        company: z.string().catch(''),
        phone: z.string().catch(''),
        /** 보험 만료일 (YYYY-MM-DD, 선택) */
        expiryDate: z.string().optional().catch(undefined),
    }).optional().nullable().catch(null),
    /** 야간 배치가 마지막으로 만료 알림을 보낸 만료일 (멱등성 마커, 백엔드 전용) */
    insuranceExpiryNotifiedFor: z.string().optional().catch(undefined),
    hipassCardNumber: z.string().optional().nullable().catch(null),
    googleCalendarId: z.string().optional().nullable().catch(null),
    calendarSyncFailCount: z.coerce.number().optional().catch(0),
    calendarSyncLastFailAt: timestampSchema.optional().catch(undefined),
    /**
     * 마지막 실패 사유 (백엔드 기록). 403(공유 권한 해제)과 404(캘린더 삭제)는 기관이 할
     * 조치가 다른데, 예전에는 카운터와 시각만 남겨 차량 문서만으로는 구분할 수 없었다.
     * 유일한 단서인 Cloud Logging은 30일 보존이라 그 전에 영구 제외로 얼어붙은 차량은
     * 원인 규명 자체가 불가능해졌다 (2026-09-03 조사).
     */
    calendarSyncLastFailReason: z.enum(['not_found', 'forbidden', 'other']).optional().catch(undefined),
    /** 마지막 실패의 HTTP 상태 코드 (403·404 등). 사유를 판별하지 못하면 기록하지 않는다. */
    calendarSyncLastFailStatus: z.coerce.number().optional().catch(undefined),
    /** 영구 중단을 기관 관리자에게 알린 시각 — 중복 발송 방지 겸 통지 여부 확인 근거 */
    calendarSyncDisabledNotifiedAt: timestampSchema.optional().catch(undefined),
    /**
     * 차량이 서 있는 **기본 차고지** id — `organization.sites[].id`.
     * 미설정·빈 값이면 본관(기관 주소)에서 출발하는 것으로 본다.
     */
    siteId: z.string().optional().catch(undefined),
    /**
     * 출발지가 매번 바뀌는 차량인가. 관리자가 켠 차량에만 운전자용 출발지 선택이 열린다.
     *
     * 기본값이 거짓이라, 분관을 등록했더라도 전 차량이 고정 출발지인 기관의 화면은 그대로다
     * (분관 기능 자체는 *분산되어 있지만 고정된* 차량을 위해 만든 것이다).
     */
    siteVaries: z.boolean().optional().catch(undefined),
    /**
     * 차량이 지금 실제로 서 있는 출발지 id. 운행 종료 기록으로 **서버 트리거가** 갱신한다.
     * 미설정이면 `siteId`(기본 차고지)에서 출발하는 것으로 본다.
     */
    currentSiteId: z.string().optional().catch(undefined),
    /** 위 값이 확인된 시각 — 화면에 "○○ 기준"으로 신선도를 함께 보여 준다. */
    currentSiteUpdatedAt: timestampSchema.optional().catch(undefined),
    /**
     * 주유(충전)가 필요한 차량인가. 운전자가 운행일지에 표시하면 **서버 트리거가** 켜고,
     * 주유일지가 작성되면 끈다. 관리자도 [차량 관리]에서 직접 끌 수 있다 —
     * 주유일지를 쓰지 않는 기관은 자동 해제가 돌지 않기 때문이다.
     *
     * 미설정은 거짓으로 본다(기존 차량 문서 마이그레이션 불필요).
     */
    needsRefuel: z.boolean().optional().catch(undefined),
    /**
     * 위 값이 바뀐 시각. 화면에 "9/5 17:20 기준"으로 신선도를 보여 주고,
     * 트리거가 **이 시각보다 과거의 운행으로는 상태를 되돌리지 않는** 근거로도 쓴다
     * (관리자가 방금 해제했는데 오전 운행이 뒤늦게 저장되어 다시 켜지는 것을 막는다).
     */
    needsRefuelAt: timestampSchema.optional().catch(undefined),
    /** 사용 가능 직원 uid 목록. undefined 또는 빈 배열 = 전체 허용 */
    allowedUserIds: z.array(z.string()).optional().catch(undefined),
    retired: vehicleRetiredSchema.nullable().optional().catch(null),
    maintenance: vehicleMaintenanceSchema.nullable().optional().catch(null),
    createdAt: timestampSchema.optional().nullable().catch(null),
});
