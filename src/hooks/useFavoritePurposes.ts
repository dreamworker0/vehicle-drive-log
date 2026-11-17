/**
 * 자주 쓰는 운행 목적 — 목록 조회·추가·삭제
 *
 * 더보기의 관리 화면과, 운행일지·바로 운행·예약 화면의 목적 칸 아래 단추가 함께 쓴다.
 * 조회는 `getFavoritePurposes`가 캐시로 묶으므로 화면마다 불러도 읽기가 늘지 않는다.
 *
 * 추가 직후에는 서버 시각(createdAt)이 아직 없으므로 다시 읽지 않고 목록 끝에 붙인다 —
 * 등록 순서로 보여 주는 화면과 같은 결과다.
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import {
    getFavoritePurposes,
    createFavoritePurpose,
    deleteFavoritePurpose,
    MAX_FAVORITE_PURPOSES,
    MAX_FAVORITE_PURPOSE_LENGTH,
} from '../lib/firestore';
import { captureError } from '../lib/sentry';
import type { FavoritePurpose } from '../types/favorite';

/** add()의 결과 — 화면이 사용자에게 알릴 문구를 고른다 */
export type AddPurposeResult = 'added' | 'duplicate' | 'full' | 'empty';

/** 비교용 정규화 — 앞뒤 공백·연속 공백 차이로 같은 목적이 두 번 들어가지 않게 한다 */
export const normalizePurpose = (text: string) => text.trim().replace(/\s+/g, ' ');

export function useFavoritePurposes() {
    const { user, userData } = useAuth();
    const uid = user?.uid;
    const [purposes, setPurposes] = useState<FavoritePurpose[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!uid) return;
        let cancelled = false;
        getFavoritePurposes(uid)
            .then(list => { if (!cancelled) setPurposes([...list]); })
            .catch(err => captureError(err, { context: 'useFavoritePurposes.load' }))
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [uid]);

    const has = useCallback(
        (text: string) => {
            const key = normalizePurpose(text);
            return !!key && purposes.some(p => normalizePurpose(p.text) === key);
        },
        [purposes],
    );

    /** 목적 추가 — 실패(네트워크·권한)는 예외로 올린다 */
    const add = useCallback(async (raw: string): Promise<AddPurposeResult> => {
        const text = normalizePurpose(raw).slice(0, MAX_FAVORITE_PURPOSE_LENGTH);
        if (!text || !uid) return 'empty';
        if (has(text)) return 'duplicate';
        if (purposes.length >= MAX_FAVORITE_PURPOSES) return 'full';
        const id = await createFavoritePurpose({
            userId: uid,
            text,
            organizationId: userData?.organizationId,
        });
        setPurposes(prev => [...prev, { id, userId: uid, text }]);
        return 'added';
    }, [uid, userData?.organizationId, has, purposes.length]);

    /** 목적 삭제 — 실패는 예외로 올린다 */
    const remove = useCallback(async (id: string) => {
        if (!uid) return;
        await deleteFavoritePurpose(id, uid);
        setPurposes(prev => prev.filter(p => p.id !== id));
    }, [uid]);

    return { purposes, loading, has, add, remove, isFull: purposes.length >= MAX_FAVORITE_PURPOSES };
}
