import { computeDistance } from '../../components/superAdmin/dashboard/dashboardUtils';
import type { SharedSnaps, MonthlyStatsSetters } from './types';

/**
 * 월간 운영 지표 (전월 대비 포함)
 */
export async function processMonthlyStats(
    shared: SharedSnaps,
    setters: MonthlyStatsSetters,
): Promise<void> {
    const { logSnap } = shared;
    const { setMonthlyStats } = setters;

    try {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();

        const prevMonth = month === 0 ? 11 : month - 1;
        const prevYear = month === 0 ? year - 1 : year;

        let monthLogs = 0, monthDistance = 0, prevLogs = 0, prevDistance = 0;
        const activeUserSet = new Set();
        const prevActiveUserSet = new Set();

        logSnap.docs.forEach(doc => {
            const data = doc.data();
            const ts = data.timestamp?.toDate ? data.timestamp.toDate() : (data.timestamp ? new Date(data.timestamp) : null);
            if (!ts) return;

            if (ts.getFullYear() === year && ts.getMonth() === month) {
                monthLogs++;
                const dist = computeDistance(data);
                monthDistance += dist;
                if (data.driverUid) activeUserSet.add(data.driverUid);
            } else if (ts.getFullYear() === prevYear && ts.getMonth() === prevMonth) {
                prevLogs++;
                const dist = computeDistance(data);
                prevDistance += dist;
                if (data.driverUid) prevActiveUserSet.add(data.driverUid);
            }
        });

        setMonthlyStats({
            monthLabel: `${year}년 ${month + 1}월`,
            logs: monthLogs,
            distance: Math.round(monthDistance),
            activeUsers: activeUserSet.size,
            prevLogs,
            prevDistance: Math.round(prevDistance),
            prevActiveUsers: prevActiveUserSet.size,
        });
    } catch (err) {
        console.error('월간 통계 로드 실패:', err);
    }
}
