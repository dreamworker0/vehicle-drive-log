import { z } from 'zod';
import { timestampSchema } from './common';

/**
 * 하이패스 충전 기록 스키마.
 *
 * 금액 필드는 카드 잔액 계산에 그대로 쓰이므로(increment 연산) 숫자로 강제한다 —
 * 문자열이 섞여 들어오면 잔액이 어긋난다. 실제로 음수 입력이 잔액을 망가뜨린
 * 사고가 있었고(#166), 그 방어는 입력·저장·Rules 3층에 있다. 여기는 읽기 측 계약이다.
 */
export const hipassChargeSchema = z.object({
    organizationId: z.string().catch(''),
    /** 하이패스 카드 ID */
    cardId: z.string().catch(''),
    /** 카드번호 (표시용) */
    cardNumber: z.string().catch(''),
    /** 연결된 차량 ID */
    vehicleId: z.string().catch(''),
    /** 표시용 차량명 */
    vehicleName: z.string().optional().catch(undefined),
    /** 충전한 사람 UID */
    chargerUid: z.string().catch(''),
    /** 충전한 사람 이름 */
    chargerName: z.string().optional().catch(undefined),
    /** 'YYYY-MM-DD' */
    date: z.string().catch(''),
    /** 충전금액 (원) */
    chargeAmount: z.coerce.number().catch(0),
    /** 충전 전 잔액 */
    balanceBefore: z.coerce.number().catch(0),
    /** 충전 후 잔액 */
    balanceAfter: z.coerce.number().catch(0),
    createdAt: timestampSchema.optional(),
    updatedAt: timestampSchema.optional(),
});

export type HipassChargeParsed = z.infer<typeof hipassChargeSchema>;
