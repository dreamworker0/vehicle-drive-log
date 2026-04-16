/**
 * Firestore — 알림 (Notifications) 관련 함수
 */
import {
    doc, updateDoc,
    collection, query, where, getDocs, addDoc,
    orderBy, limit, serverTimestamp, onSnapshot,
    type DocumentData,
} from 'firebase/firestore';
import { db } from '../firebase';
import { captureError } from '../sentry';

// 알림 생성
export const createNotification = async (data: Record<string, unknown>) => {
    try {
        return await addDoc(collection(db, 'notifications'), {
            ...data,
            read: false,
            createdAt: serverTimestamp(),
        });
    } catch (error) {
        captureError(error as Error, { context: 'createNotification', data });
        throw error;
    }
};

// 알림 목록 조회
export const getNotifications = async (uid: string, limitCount = 20) => {
    const q = query(
        collection(db, 'notifications'),
        where('targetUid', '==', uid),
        orderBy('createdAt', 'desc'),
        limit(limitCount)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }) as DocumentData & { id: string });
};

// 알림 읽음 처리
export const markNotificationRead = async (notificationId: string) => {
    try {
        await updateDoc(doc(db, 'notifications', notificationId), {
            read: true,
        });
    } catch (error) {
        captureError(error as Error, { context: 'markNotificationRead', notificationId });
        throw error;
    }
};

// 미읽은 알림 실시간 구독
export const subscribeNotifications = (uid: string, callback: (notifications: (DocumentData & { id: string })[]) => void) => {
    const q = query(
        collection(db, 'notifications'),
        where('targetUid', '==', uid),
        where('read', '==', false),
        orderBy('createdAt', 'desc'),
        limit(10)
    );
    return onSnapshot(q, (snap) => {
        const notifications = snap.docs.map(d => ({ id: d.id, ...d.data() }) as DocumentData & { id: string });
        callback(notifications);
    });
};
