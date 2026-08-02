/**
 * 전체 공지 발송 이력 타입
 *
 * `sendBroadcastNotice`(Admin SDK)만 기록하며 Rules가 클라이언트 쓰기를 전면 차단한다.
 * 읽기도 superAdmin 한정 — 운영자가 "언제 무엇을 몇 명에게 보냈는가"를 확인하기 위한
 * 기록이고, 발송자 uid가 담기므로 공개할 이유가 없다.
 */
import type { FirestoreDoc, TimestampField } from './common';

/**
 * 발송 상태.
 * - `sending`: 앱 내 알림은 커밋됐고 푸시 결과는 아직 기록되지 않았다.
 *   함수가 푸시 도중 죽으면 이 상태로 남는다 — "보냈는지 모른다"가 아니라
 *   "알림은 나갔고 푸시 결과만 모른다"를 뜻한다.
 * - `sent`: 푸시까지 끝나 결과 수가 기록됐다.
 */
export type BroadcastStatus = 'sending' | 'sent';

export interface Broadcast extends FirestoreDoc {
    title: string;
    message: string;
    /** 발송한 운영자 uid */
    actorUid: string;
    /** 앱 내 알림을 받은 인원 */
    recipientCount: number;
    /** 푸시 성공·실패 수. `sending` 상태에서는 없다. */
    pushSent?: number;
    pushFailed?: number;
    status: BroadcastStatus;
    sentAt: TimestampField;
    completedAt?: TimestampField;
}
