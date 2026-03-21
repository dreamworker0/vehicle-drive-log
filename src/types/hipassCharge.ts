/**
 * 하이패스 충전 기록 (HipassCharges) 타입 정의
 */
import type { FirestoreDoc, TimestampField } from './common';

export interface HipassCharge extends FirestoreDoc {
    organizationId: string;
    cardId: string;            // 하이패스 카드 ID
    cardNumber: string;        // 카드번호 (표시용)
    vehicleId: string;         // 연결된 차량 ID
    vehicleName?: string;      // 표시용 차량명
    chargerUid: string;        // 충전한 사람 UID
    chargerName?: string;      // 충전한 사람 이름
    date: string;              // 'YYYY-MM-DD'
    chargeAmount: number;      // 충전금액 (원)
    balanceBefore: number;     // 충전 전 잔액
    balanceAfter: number;      // 충전 후 잔액
    createdAt?: TimestampField;
}

/** createHipassCharge에 전달할 데이터 */
export type CreateHipassChargeData = Omit<HipassCharge, 'id' | 'createdAt'>;
