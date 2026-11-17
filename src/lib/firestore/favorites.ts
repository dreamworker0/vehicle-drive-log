/**
 * Firestore — 즐겨찾기 (Favorites) 관련 함수
 *
 * 쓰기 경로가 네 곳(즐겨찾기 관리·예약 폼·바로 운행·운행일지 폼)이라 저장 모양이 갈라져 있었다.
 * 어느 화면에서 저장했는지에 따라 `address`만 있거나 `destination`만 있는 문서가 섞여, 읽는
 * 화면마다 폴백 규칙을 따로 들고 있었다. 정규화를 **이 파일 한 곳으로** 모아, 호출부는
 * 별칭·주소만 넘기고 `fav.destination`을 믿고 쓰면 되게 한다.
 */
import {
    doc, deleteDoc,
    collection, query, where, getDocs, addDoc,
    orderBy, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { captureError } from '../sentry';
import { createZodConverter, favoriteSchema, favoritePurposeSchema } from '../../schemas';
import type { Favorite, FavoritePurpose } from '../../types/favorite';
import { cachedQuery, invalidateCache } from './cache';

// 읽기 경로에 스키마 검증을 건다 — 이전에는 `d.data()`를 그대로 돌려주고 호출부에서
// `as Favorite[]`로 받아, 두 캐스팅 사이에 실제 검증이 없었다.
const favoritesRef = () => collection(db, 'favorites').withConverter(createZodConverter(favoriteSchema));

/** createFavorite에 넘기는 값 — 화면은 별칭과(있으면) 주소만 알면 된다 */
export interface FavoriteInput {
    userId: string;
    /** 별칭 (필수) */
    name: string;
    /** 사용자가 입력한 주소 (없을 수 있다) */
    address?: string;
    /** 이미 정규화된 목적지 값을 직접 넘기는 경우 */
    destination?: string;
    purpose?: string;
    /** 소속 기관. 아직 소속이 없는 계정은 null이 올 수 있다 */
    organizationId?: string | null;
}

/**
 * 저장 모양을 한 곳에서 맞춘다.
 *
 * `destination`은 **항상 비어 있지 않게** 채운다 — 주소를 안 적었으면 별칭이 목적지다.
 * `address`는 사용자가 실제로 입력한 값만 남긴다(빈 값이면 필드를 아예 넣지 않는다).
 * Firestore는 undefined 필드를 거부하므로 값이 없는 키는 페이로드에서 제거한다.
 */
const normalizeFavorite = (input: FavoriteInput) => {
    const name = (input.name || '').trim();
    const address = (input.address || '').trim();
    const destination = (input.destination || '').trim() || address || name;
    return {
        userId: input.userId,
        name,
        destination,
        ...(address ? { address } : {}),
        ...(input.purpose?.trim() ? { purpose: input.purpose.trim() } : {}),
        ...(input.organizationId ? { organizationId: input.organizationId } : {}),
    };
};

/** 즐겨찾기 목록 조회 (사용자 스코프, 최신순) */
export const getFavorites = async (uid: string): Promise<Favorite[]> => {
    const q = query(
        favoritesRef(),
        where('userId', '==', uid),
        orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => {
        const data = d.data();
        // `destination`을 기록하지 않던 시절의 문서를 여기서 보정한다 — 화면마다 폴백을
        // 두는 대신 읽기 입구에서 한 번 채워, 호출부는 fav.destination만 보면 된다.
        return { ...data, id: d.id, destination: data.destination || data.address || data.name };
    });
};

/** 즐겨찾기 추가 — 저장 모양은 normalizeFavorite이 맞춘다 */
export const createFavorite = async (input: FavoriteInput) => {
    try {
        return await addDoc(collection(db, 'favorites'), {
            ...normalizeFavorite(input),
            createdAt: serverTimestamp(),
        });
    } catch (error) {
        captureError(error as Error, { context: 'createFavorite', data: input });
        throw error;
    }
};

/** 즐겨찾기 삭제 */
export const deleteFavorite = async (favoriteId: string) => {
    try {
        await deleteDoc(doc(db, 'favorites', favoriteId));
    } catch (error) {
        captureError(error as Error, { context: 'deleteFavorite', favoriteId });
        throw error;
    }
};

// ─── 자주 쓰는 운행 목적 (favoritePurposes) ───────────────────────────────────
//
// 목적지 즐겨찾기와 같은 개인 범위 데이터라 같은 파일에 둔다. 운행일지·바로 운행·예약 화면이
// 저마다 목적 칸 아래 단추를 그리므로 한 화면에서 여러 번 부를 수 있다 — 조회는 캐시로 묶고,
// 추가·삭제 때 무효화한다.

const favoritePurposesRef = () =>
    collection(db, 'favoritePurposes').withConverter(createZodConverter(favoritePurposeSchema));

/** 한 사람이 등록할 수 있는 목적 개수 — 단추가 화면을 덮지 않게 막는다 */
export const MAX_FAVORITE_PURPOSES = 20;
/** 목적 문구 최대 길이 — Rules 상한(100)보다 좁게 잡는다 */
export const MAX_FAVORITE_PURPOSE_LENGTH = 50;

const purposeCacheKey = (uid: string) => `favoritePurposes:${uid}`;

/** Timestamp·Date 모두에서 정렬용 밀리초를 꺼낸다 (아직 서버 시각이 없으면 맨 뒤로) */
const createdAtMillis = (value: unknown): number => {
    if (value instanceof Date) return value.getTime();
    const ts = value as { toMillis?: () => number } | undefined;
    return typeof ts?.toMillis === 'function' ? ts.toMillis() : Number.MAX_SAFE_INTEGER;
};

/**
 * 자주 쓰는 목적 목록 (사용자 스코프, **등록한 순서**).
 *
 * 먼저 등록한 것이 가장 자주 쓰는 것일 가능성이 높아 단추도 그 순서로 보인다.
 * 정렬은 클라이언트에서 한다 — userId 단일 조건이라 복합 인덱스가 필요 없다.
 */
export const getFavoritePurposes = (uid: string): Promise<FavoritePurpose[]> =>
    cachedQuery(purposeCacheKey(uid), async () => {
        const snap = await getDocs(query(favoritePurposesRef(), where('userId', '==', uid)));
        return snap.docs
            .map(d => ({ ...d.data(), id: d.id }))
            .filter(p => p.text.trim())
            .sort((a, b) => createdAtMillis(a.createdAt) - createdAtMillis(b.createdAt));
    }, 5 * 60_000);

/** 자주 쓰는 목적 추가 — 저장한 문서 ID를 돌려준다 */
export const createFavoritePurpose = async (input: {
    userId: string;
    text: string;
    organizationId?: string | null;
}): Promise<string> => {
    const text = input.text.trim().slice(0, MAX_FAVORITE_PURPOSE_LENGTH);
    try {
        const ref = await addDoc(collection(db, 'favoritePurposes'), {
            userId: input.userId,
            text,
            ...(input.organizationId ? { organizationId: input.organizationId } : {}),
            createdAt: serverTimestamp(),
        });
        return ref.id;
    } catch (error) {
        captureError(error as Error, { context: 'createFavoritePurpose' });
        throw error;
    } finally {
        invalidateCache(purposeCacheKey(input.userId));
    }
};

/** 자주 쓰는 목적 삭제 */
export const deleteFavoritePurpose = async (purposeId: string, uid: string) => {
    try {
        await deleteDoc(doc(db, 'favoritePurposes', purposeId));
    } catch (error) {
        captureError(error as Error, { context: 'deleteFavoritePurpose', purposeId });
        throw error;
    } finally {
        invalidateCache(purposeCacheKey(uid));
    }
};
