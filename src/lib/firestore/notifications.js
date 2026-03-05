/**
 * Firestore — 알림 (Notifications) 관련 함수
 */
import {
    doc, updateDoc,
    collection, query, where, getDocs, addDoc,
    orderBy, limit, serverTimestamp, onSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';

// 알림 생성
export const createNotification = async (data) => {
    return await addDoc(collection(db, 'notifications'), {
        ...data,
        read: false,
        createdAt: serverTimestamp(),
    });
};

// 알림 목록 조회
export const getNotifications = async (uid, limitCount = 20) => {
    const q = query(
        collection(db, 'notifications'),
        where('targetUid', '==', uid),
        orderBy('createdAt', 'desc'),
        limit(limitCount)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// 알림 읽음 처리
export const markNotificationRead = async (notificationId) => {
    await updateDoc(doc(db, 'notifications', notificationId), {
        read: true,
    });
};

// 미읽은 알림 실시간 구독
export const subscribeNotifications = (uid, callback) => {
    const q = query(
        collection(db, 'notifications'),
        where('targetUid', '==', uid),
        where('read', '==', false),
        orderBy('createdAt', 'desc'),
        limit(10)
    );
    return onSnapshot(q, (snap) => {
        const notifications = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(notifications);
    });
};
