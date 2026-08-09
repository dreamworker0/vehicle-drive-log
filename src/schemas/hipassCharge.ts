import { z } from 'zod';
import { timestampSchema } from './vehicle';

/**
 * 하이패스 충전 기록 스키마.
 *
 * 금액 필드는 카드 잔액 계산에 그대로 쓰이므로(increment 연산) 숫자로 강제한다 —
 * 문자열이 섞여 들어오면 잔액이 어긋난다. 실제로 음수 입력이 잔액을 망가뜨린
 * 사고가 있었고(#166), 그 방어는 입력·저장·Rules 3층에 있다. 여기는 읽기 측 계약이다.
 */
export const hipassChargeSchema = z.object({
    organizationId: z.string().catch(''),
    cardId: z.string().catch(''),
    cardNumber: z.string().catch(''),
    vehicleId: z.string().catch(''),
    vehicleName: z.string().optional().catch(undefined),
    chargerUid: z.string().catch(''),
    chargerName: z.string().optional().catch(undefined),
    date: z.string().catch(''),
    chargeAmount: z.coerce.number().catch(0),
    balanceBefore: z.coerce.number().catch(0),
    balanceAfter: z.coerce.number().catch(0),
    createdAt: timestampSchema.optional(),
    updatedAt: timestampSchema.optional(),
});

export type HipassChargeParsed = z.infer<typeof hipassChargeSchema>;
