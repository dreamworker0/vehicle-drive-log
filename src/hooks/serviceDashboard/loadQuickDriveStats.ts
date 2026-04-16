import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import type { QuickDriveSetters } from './types';

/**
 * 바로 운행 vs 사전 예약 통계 + 추천 예약 통계
 */
export async function loadQuickDriveStats(
    setters: QuickDriveSetters,
): Promise<void> {
    const { setQuickDriveStats, setQuickDriveRatio, setRecommendationStats, setRecommendationRatio } = setters;

    try {
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
        const thirtyDaysAgoStr = `${thirtyDaysAgo.getFullYear()}-${String(thirtyDaysAgo.getMonth() + 1).padStart(2, '0')}-${String(thirtyDaysAgo.getDate()).padStart(2, '0')}`;

        const q = query(collection(db, 'reservations'), where('date', '>=', thirtyDaysAgoStr));
        const snap = await getDocs(q);

        const dailyMap: Record<string, { regular: number; quick: number; recommendation: number; normal: number }> = {};
        for (let i = 0; i < 30; i++) {
            const d = new Date(thirtyDaysAgo);
            d.setDate(d.getDate() + i);
            const key = `${d.getMonth() + 1}/${d.getDate()}`;
            dailyMap[key] = { regular: 0, quick: 0, recommendation: 0, normal: 0 };
        }

        let total = 0, quick = 0, regular = 0;
        let recTotal = 0, recommendation = 0, normal = 0;

        snap.docs.forEach(doc => {
            const data = doc.data();
            if (data.status === 'cancelled') return; // 취소된 예약은 제외

            const dStr = data.date as string;
            if (!dStr) return;
            const [y, m, dd] = dStr.split('-').map(Number);
            const parsed = new Date(y, m - 1, dd);
            if (parsed >= thirtyDaysAgo) {
                const key = `${parsed.getMonth() + 1}/${parsed.getDate()}`;
                total++;
                recTotal++;

                if (data.isQuickDrive) {
                    quick++;
                    if (dailyMap[key]) dailyMap[key].quick++;
                } else {
                    regular++;
                    if (dailyMap[key]) dailyMap[key].regular++;
                }

                if (data.source === 'recommendation') {
                    recommendation++;
                    if (dailyMap[key]) dailyMap[key].recommendation++;
                } else {
                    normal++;
                    if (dailyMap[key]) dailyMap[key].normal++;
                }
            }
        });

        setQuickDriveRatio({ total, quick, regular, rate: total > 0 ? Math.round((quick / total) * 100) : 0 });
        setQuickDriveStats(Object.entries(dailyMap).map(([date, counts]) => ({ date, regular: counts.regular, quick: counts.quick })));

        setRecommendationRatio({ total: recTotal, recommendation, normal, rate: recTotal > 0 ? Math.round((recommendation / recTotal) * 100) : 0 });
        setRecommendationStats(Object.entries(dailyMap).map(([date, counts]) => ({ date, recommendation: counts.recommendation, normal: counts.normal })));
    } catch (err) {
        console.error('바로 운행 및 추천 예약 통계 로드 실패:', err);
    }
}
