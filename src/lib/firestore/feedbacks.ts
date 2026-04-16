/**
 * Firestore — 피드백 (Feedbacks) 관련 함수
 */
import {
    doc, updateDoc, deleteDoc,
    collection, query, where, getDocs, addDoc, getCountFromServer,
    orderBy, limit, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { captureError } from '../sentry';
import type { Feedback, CreateFeedbackData } from '../../types/feedback';

// 피드백 생성
export const createFeedback = async (data: CreateFeedbackData) => {
    try {
        return await addDoc(collection(db, 'feedbacks'), {
            ...data,
            status: 'unread',
            createdAt: serverTimestamp(),
        });
    } catch (error) {
        captureError(error as Error, { context: 'createFeedback', data });
        throw error;
    }
};

// 읽지 않은 피드백 카운트
export const getUnreadFeedbacksCount = async () => {
    const q = query(
        collection(db, 'feedbacks'),
        where('status', 'in', ['unread', 'in_progress'])
    );
    const snap = await getCountFromServer(q);
    return snap.data().count;
};

// 전체 피드백 목록 조회
export const getAllFeedbacks = async (limitCount = 100): Promise<Feedback[]> => {
    const q = query(
        collection(db, 'feedbacks'),
        orderBy('createdAt', 'desc'),
        limit(limitCount)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }) as Feedback);
};

// 피드백 상태 수정
export const updateFeedback = async (feedbackId: string, data: Record<string, unknown>) => {
    try {
        await updateDoc(doc(db, 'feedbacks', feedbackId), data);
    } catch (error) {
        captureError(error as Error, { context: 'updateFeedback', feedbackId, data });
        throw error;
    }
};

// 피드백 삭제
export const deleteFeedback = async (feedbackId: string) => {
    try {
        await deleteDoc(doc(db, 'feedbacks', feedbackId));
    } catch (error) {
        captureError(error as Error, { context: 'deleteFeedback', feedbackId });
        throw error;
    }
};
