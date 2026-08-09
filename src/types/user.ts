/**
 * 사용자 (Users) 타입
 *
 * 문서 모양의 원본은 `src/schemas/user.ts`다 — 여기서는 파생만 한다.
 */
import type { z } from 'zod';
import type { userSchema, userRoleSchema } from '../schemas/user';
import type { FirestoreDoc } from './common';

export type UserRole = z.infer<typeof userRoleSchema>;

export type User = z.infer<typeof userSchema> & FirestoreDoc;

/** createUser에 전달할 데이터 (id, createdAt 제외) */
export type CreateUserData = Omit<User, 'id' | 'createdAt'>;
