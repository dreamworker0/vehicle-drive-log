/**
 * 하이패스 카드 (HipassCards) 타입 정의
 */
import type { FirestoreDoc, TimestampField } from './common';

export interface HipassCard extends FirestoreDoc {
    organizationId: string;
    cardNumber: string;        // 하이패스 카드번호 (XXXX-XXXX-XXXX-XXXX)
    vehicleId: string;         // 연결된 차량 ID
    vehicleName?: string;      // 표시용 차량명 (비정규화)
    balance: number;           // 현재 잔액 (원)
    memo?: string;             // 메모
    /**
     * 검산 기준점 — 이 시점의 잔액이 `balanceBaseline`이었다.
     *
     * 잔액은 서버 트리거가 **증분으로** 굴린다(Phase 227). 증분 회계는 한 번 어긋나면
     * 스스로 복구되지 않는데, 기준점이 없으면 어긋났다는 사실조차 알 수 없다 —
     * "지금 잔액이 맞는가"를 물으려면 **무엇으로부터 얼마가 오갔는가**를 알아야 한다.
     *
     * 이 둘이 있으면 언제든 대조할 수 있다:
     *   잔액 == balanceBaseline + Σ(baselineAt 이후 충전) − Σ(baselineAt 이후 하이패스 사용)
     * (`scripts/check-hipass-balance-drift.ts`가 그 계산을 한다.)
     *
     * 사람이 [하이패스 관리]에서 잔액을 손으로 고치면 그 값이 **새 기준점**이 된다 —
     * 실물 카드를 보고 맞춘 것이므로 그 시점부터 다시 세는 것이 옳다.
     */
    balanceBaseline?: number;
    baselineAt?: TimestampField;
    createdAt?: TimestampField;
    updatedAt?: TimestampField;
}

/** createHipassCard에 전달할 데이터 */
export type CreateHipassCardData = Omit<HipassCard, 'id' | 'createdAt' | 'updatedAt'>;
