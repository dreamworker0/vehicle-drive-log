/**
 * 전체 공지 발송 이력 타입
 *
 * 문서 모양의 원본은 `src/schemas/broadcast.ts`다 — 여기서는 파생만 한다.
 *
 * `sendBroadcastNotice`(Admin SDK)만 기록하며 Rules가 클라이언트 쓰기를 전면 차단한다.
 * 읽기도 superAdmin 한정 — 운영자가 "언제 무엇을 몇 명에게 보냈는가"를 확인하기 위한
 * 기록이고, 발송자 uid가 담기므로 공개할 이유가 없다.
 */
import type { z } from 'zod';
import type { broadcastSchema, broadcastStatusSchema } from '../schemas/broadcast';
import type { FirestoreDoc } from './common';

export type BroadcastStatus = z.infer<typeof broadcastStatusSchema>;

export type Broadcast = z.infer<typeof broadcastSchema> & FirestoreDoc;
