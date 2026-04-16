import * as functions from 'firebase-functions/v1';
import { getFirestore } from 'firebase-admin/firestore';
import { log } from './helpers';

export const onUserDelete = functions
    .region('asia-northeast3')
    .auth.user()
    .onDelete(async (user) => {
        const uid = user.uid;
        const db = getFirestore();

        const userRef = db.collection('users').doc(uid);
        try {
            await userRef.update({
                name: '*** (탈퇴된 사용자)',
                email: `deleted-user-${uid}@example.com`,
                phone: '***-****-****',
                status: 'disabled',
                photoURL: '',
                deletedAt: new Date().toISOString()
            });
            log('INFO', 'onUserDelete', '유저 익명화 처리 완료', { uid });
        } catch (error: any) {
            if (error.code === 5) {
                log('INFO', 'onUserDelete', '유저 문서가 존재하지 않아 익명화를 생략합니다.', { uid });
            } else {
                log('ERROR', 'onUserDelete', '유저 익명화 실패', { uid, error: error.message });
            }
        }
    });
