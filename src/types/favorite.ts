/**
 * 즐겨찾기 (Favorites) 타입
 *
 * 문서 모양의 원본은 `src/schemas/favorite.ts`다 — 여기서는 파생만 한다.
 */
import type { z } from 'zod';
import type { favoriteSchema } from '../schemas/favorite';
import type { FirestoreDoc } from './common';

export type Favorite = z.infer<typeof favoriteSchema> & FirestoreDoc;
