import { collection, getDocs, query, where, limit, getCountFromServer, Timestamp, type QueryConstraint } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import type { NotificationSetters } from './types';

// 일별 차트용 원본 문서 조회 상한 — 알림은 발생량이 가장 많은 컬렉션이라 무제한 스캔 방어 필수
const DAILY_CHART_FETCH_MAX = 5000;

const NOTIF_TYPE_LABELS_LOCAL: Record<string, string> = {
    admin_notice: '관리자 공지', notice: '공지사항',
    reservation_confirmed: '예약 확정', reservation_reminder: '예약 알림',
    reservation_cancelled: '예약 취소', reservation_changed: '예약 변경',
    reservation_cancelled_maintenance: '정비 취소', drive_log_reminder: '운행일지 알림',
    no_show_reminder: '노쇼 알림', approval: '승인', rejection: '반려',
    maintenance: '정비 알림', drive: '운행 알림', system: '시스템',
};

const NOTIF_TYPE_COLORS_LOCAL: Record<string, string> = {
    admin_notice: '#8b5cf6', notice: '#a78bfa',
    reservation_confirmed: '#f59e0b', reservation_reminder: '#fbbf24',
    reservation_cancelled: '#ef4444', reservation_changed: '#f97316',
    reservation_cancelled_maintenance: '#dc2626', drive_log_reminder: '#10b981',
    no_show_reminder: '#3b82f6', approval: '#6b7280', rejection: '#9ca3af',
    maintenance: '#eab308', drive: '#22c55e', system: '#64748b',
};

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

        const colorPalette = ['#8b5cf6', '#f59e0b', '#3b82f6', '#10b981', '#6b7280', '#ef4444', '#ec4899', '#06b6d4'];
        setNotifTypeStats(
            Object.entries(typeMap)
                .map(([type, cnt], idx) => ({
                    type: NOTIF_TYPE_LABELS_LOCAL[type] || type,
                    count: cnt,
                    color: NOTIF_TYPE_COLORS_LOCAL[type] || colorPalette[idx % colorPalette.length],
                }))
                .sort((a, b) => b.count - a.count)
        );
    } catch (err) {
        console.error('알림 통계 로드 실패:', err);
    }
}
