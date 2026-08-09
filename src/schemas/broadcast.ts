import { z } from 'zod';
// 배럴(./index)이 이 파일을 re-export하므로 './index'에서 가져오면 순환 참조가 된다.
// 다른 스키마 파일(auditLog 등)과 같이 정의 파일에서 직접 가져온다.
import { timestampSchema } from './common';

export const broadcastStatusSchema = z.enum(['sending', 'sent']);

/**
 * 전체 공지 발송 이력 스키마
 *
 * createZodConverter의 fromFirestore는 Zod가 모르는 키를 조용히 제거하므로,
 * 필드를 추가할 때 types/broadcast.ts와 반드시 함께 갱신해야 한다.
 * (organizations.consent를 스키마에 빠뜨려 저장은 되고 조회는 안 되는 결함을 겪었다.)
 *
 * `sentAt`은 서버가 **항상** 쓰므로 필수로 둔다. optional이면 Broadcast 타입과
 * 상호 대입이 안 되어 목록 화면에서 캐스팅이 끼어든다.
 */
export const broadcastSchema = z.object({
    id: z.string().catch(''),
    title: z.string().catch(''),
    message: z.string().catch(''),
    actorUid: z.string().catch(''),
    recipientCount: z.number().catch(0),
    /** 푸시 결과는 `sending` 상태에서 아직 없다 */
    pushSent: z.number().optional().catch(undefined),
    pushFailed: z.number().optional().catch(undefined),
    status: broadcastStatusSchema.catch('sent'),
    sentAt: timestampSchema,
    completedAt: timestampSchema.optional().catch(undefined),
});

export type BroadcastSchemaType = z.infer<typeof broadcastSchema>;
