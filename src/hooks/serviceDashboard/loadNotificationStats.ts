import { collection, getDocs, query, where, limit, getCountFromServer, Timestamp, type QueryConstraint } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import type { NotificationSetters } from './types';
import { mapNotifTypeCounts } from '../../components/superAdmin/dashboard/dashboardUtils';

// 일별 차트용 원본 문서 조회 상한 — 알림은 발생량이 가장 많은 컬렉션이라 무제한 스캔 방어 필수
const DAILY_CHART_FETCH_MAX = 5000;

/**
 * 알림 통계 로드
 */
export async function loadNotificationStats(
    setters: NotificationSetters,
    orgFilterId: string = 'ALL',
): Promise<void> {
    const { setNotifSummary, setDailyNotifStats, setNotifTypeStats } = setters;
    const orgScope: QueryConstraint[] = orgFilterId === 'ALL' ? [] : [where('organizationId', '==', orgFilterId)];

    try {
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
        const notifCol = collection(db, 'notifications');

        const [totalCountResult, readCountResult, notifRecentSnap] = await Promise.all([
            getCountFromServer(query(notifCol, ...orgScope)),
            getCountFromServer(query(notifCol, ...orgScope, where('read', '==', true))),
            getDocs(query(notifCol, ...orgScope, where('createdAt', '>=', Timestamp.fromDate(thirtyDaysAgo)), limit(DAILY_CHART_FETCH_MAX))),
        ]);

        if (notifRecentSnap.size >= DAILY_CHART_FETCH_MAX) {
            console.warn(`[Dashboard] 일별 알림 차트 조회가 상한(${DAILY_CHART_FETCH_MAX}건)에 도달 — 차트가 일부 누락될 수 있습니다.`);
        }

        const total = totalCountResult.data().count;
        const readCount = readCountResult.data().count;
        const unreadCount = total - readCount;

        const dailyMap: Record<string, { sent: number; read: number }> = {};
        const typeMap: Record<string, number> = {};

        for (let i = 0; i < 30; i++) {
            const d = new Date(thirtyDaysAgo);
            d.setDate(d.getDate() + i);
            const key = `${d.getMonth() + 1}/${d.getDate()}`;
            dailyMap[key] = { sent: 0, read: 0 };
        }

        notifRecentSnap.docs.forEach(doc => {
            const data = doc.data();

            const t = (data.type as string) || 'system';
            typeMap[t] = (typeMap[t] || 0) + 1;

            const ts = data.createdAt?.toDate ? data.createdAt.toDate() : (data.createdAt ? new Date(data.createdAt) : null);
            if (ts && ts >= thirtyDaysAgo) {
                const dateKey = `${ts.getMonth() + 1}/${ts.getDate()}`;
                if (dailyMap[dateKey]) {
                    dailyMap[dateKey].sent++;
                    if (data.read) dailyMap[dateKey].read++;
                }
            }
        });

        setNotifSummary({
            total,
            read: readCount,
            unread: unreadCount,
            readRate: total > 0 ? Math.round((readCount / total) * 100) : 0,
        });

        setDailyNotifStats(
            Object.entries(dailyMap).map(([date, counts]) => ({ date, ...counts }))
        );

        setNotifTypeStats(
            mapNotifTypeCounts(Object.entries(typeMap).map(([type, count]) => ({ type, count })))
        );
    } catch (err) {
        console.error('알림 통계 로드 실패:', err);
    }
}
