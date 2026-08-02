/**
 * Firestore — 전체 공지 발송 이력 (superAdmin 전용, 읽기만)
 *
 * 쓰기는 `sendBroadcastNotice`(Admin SDK)만 하고 Rules가 클라이언트 쓰기를 차단한다.
 * 기관 경계가 없는 전역 도메인이라 `organizationId` 필터가 없다 —
 * 이 컬렉션은 서비스 운영 기록이지 기관 데이터가 아니다.
 */
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { createZodConverter, broadcastSchema } from '../../schemas';
import type { Broadcast } from '../../types/broadcast';
import { captureError } from '../sentry';

const broadcastConverter = createZodConverter(broadcastSchema);

/**
 * 최근 발송 이력을 최신순으로 조회한다.
 *
 * 상한을 두는 이유: 목록은 "최근에 무엇을 보냈는가"를 확인하는 용도라 전량이 필요 없고,
 * 상한이 없으면 운영 기간이 길어질수록 화면 진입 비용이 조용히 늘어난다.
 */
export const getRecentBroadcasts = async (max = 20): Promise<Broadcast[]> => {
    try {
        const q = query(
            collection(db, 'broadcasts').withConverter(broadcastConverter),
            orderBy('sentAt', 'desc'),
            limit(max),
        );
        const snap = await getDocs(q);
        return snap.docs.map((d) => ({ ...d.data(), id: d.id })) as Broadcast[];
    } catch (error) {
        captureError(error, { context: 'getRecentBroadcasts' });
        throw error;
    }
};
