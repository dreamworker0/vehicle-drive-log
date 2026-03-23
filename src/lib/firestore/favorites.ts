/**
 * Firestore — 즐겨찾기 (Favorites) 관련 함수
 */
import {
    doc, deleteDoc,
    collection, query, where, getDocs, addDoc,
    orderBy, serverTimestamp,
    type DocumentData,
} from 'firebase/firestore';
import { db } from '../firebase';

// 즐겨찾기 목록 조회
export const getFavorites = async (uid: string) => {
    const q = query(
        collection(db, 'favorites'),
        where('userId', '==', uid),
        orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }) as DocumentData & { id: string });
};

// 즐겨찾기 추가
export const createFavorite = async (data: Record<string, unknown>) => {
    return await addDoc(collection(db, 'favorites'), {
        ...data,
        createdAt: serverTimestamp(),
    });
};

// 즐겨찾기 삭제
export const deleteFavorite = async (favoriteId: string) => {
    await deleteDoc(doc(db, 'favorites', favoriteId));
};
