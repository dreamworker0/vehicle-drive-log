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
    createdAt?: TimestampField;
    updatedAt?: TimestampField;
}

/** createHipassCard에 전달할 데이터 */
export type CreateHipassCardData = Omit<HipassCard, 'id' | 'createdAt' | 'updatedAt'>;
