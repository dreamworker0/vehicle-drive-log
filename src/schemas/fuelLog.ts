import { z } from 'zod';
import { timestampSchema } from './common';
import { fuelTypeSchema } from './vehicle';

/**
 * 주유·충전 기록 스키마.
 *
 * 이 도메인은 컨버터가 없어 `d.data() as Record<string, unknown>`으로 원시 캐스팅해
 * 반환했고, 호출부(useBaseFuelLog·useFuelLogAdmin)에서 다시 `as FuelLog[]`로 받았다.
 * 두 번의 캐스팅 사이에 실제 검증이 없어 타입은 선언일 뿐이었다.
 *
 * `.catch()` 폴백을 쓰는 이유는 다른 도메인과 같다 — 필드가 비거나 형식이 어긋난
 * 옛 문서 하나 때문에 목록 화면 전체가 깨지면 안 된다. 파싱 실패는 Sentry로 올라간다
 * (createZodConverter의 [Zod] 경고).
 */
export const fuelLogSchema = z.object({
    organizationId: z.string().catch(''),
    vehicleId: z.string().catch(''),
    vehicleName: z.string().optional().catch(undefined),
    driverUid: z.string().catch(''),
    driverName: z.string().optional().catch(undefined),
    /** 'YYYY-MM-DD' */
    date: z.string().catch(''),
    /** 주유 시 계기판 km */
    meterReading: z.coerce.number().catch(0),
    /** 계기판 촬영 사진 URL. null을 허용하지 않는다 — 없으면 undefined 하나로 표현한다 */
    meterPhotoUrl: z.string().optional().catch(undefined),
    /** 연료 유형 (미지정 시 기본 시스템 정책 따름) */
    fuelType: fuelTypeSchema.optional().catch(undefined),
    /** 주유량 (리터) 또는 충전량 (kWh/kg) */
    fuelAmount: z.coerce.number().catch(0),
    /** 주유 금액 또는 충전 금액 (원) */
    fuelCost: z.coerce.number().catch(0),
    /** 비고 (선택) */
    notes: z.string().optional().catch(undefined),
    /**
     * 마지막으로 이 기록을 고친 사람의 UID(행위자 스탬프).
     *
     * 관리자가 직원의 기록을 대신 정정할 수 있으므로, 화면의 '주유원'과 실제 수정자가
     * 달라질 수 있다. 이 값이 있고 driverUid와 다르면 목록에 '관리자 수정' 표시를 띄운다 —
     * 지출결의서와 대조하는 금액이 누구 손에서 바뀌었는지 흔적 없이 사라지면 안 된다.
     * 값의 신뢰는 Rules의 `actorStampValid()`가 담보한다(타인 명의 위조 불가).
     */
    lastEditedByUid: z.string().optional().catch(undefined),
    createdAt: timestampSchema.optional(),
    updatedAt: timestampSchema.optional(),
});

export type FuelLogParsed = z.infer<typeof fuelLogSchema>;
