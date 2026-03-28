/**
 * Firestore — 피드백 (Feedbacks) 관련 함수
 */
import {
    doc, updateDoc, deleteDoc,
    collection, query, getDocs, addDoc,
    orderBy, limit, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Feedback, CreateFeedbackData } from '../../types/feedback';

// 피드백 생성
export const createFeedback = async (data: CreateFeedbackData) => {
    return await addDoc(collection(db, 'feedbacks'), {
        ...data,
        status: 'unread',
        createdAt: serverTimestamp(),
    });
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
    await updateDoc(doc(db, 'feedbacks', feedbackId), data);
};

// 피드백 삭제
export const deleteFeedback = async (feedbackId: string) => {
    await deleteDoc(doc(db, 'feedbacks', feedbackId));
};
