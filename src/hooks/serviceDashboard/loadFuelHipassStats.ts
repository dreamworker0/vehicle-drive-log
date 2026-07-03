import { collection, getDocs, query, where, limit, getAggregateFromServer, sum, count, type QueryConstraint } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import type { FuelHipassSetters } from './types';

// 일별 차트용 원본 문서 조회 상한 — 전 테넌트 30일치가 무제한으로 열리지 않도록 방어
const DAILY_CHART_FETCH_MAX = 5000;

/**
 * 주유/하이패스 통계 로드 (서버 집계 + 기간 필터 최적화)
 * @param orgFilterId 'ALL'이면 전체 서비스, 기관 ID면 해당 기관으로 스코프 (캐시 문서 dashboardStats_{orgId}와 동일 규약)
 */
export async function loadFuelHipassStats(
    setters: FuelHipassSetters,
    orgFilterId: string = 'ALL',
): Promise<void> {
    const { setFuelStats, setHipassStats, setDailyFuelCost, setDailyHipassAmount } = setters;
    const orgScope: QueryConstraint[] = orgFilterId === 'ALL' ? [] : [where('organizationId', '==', orgFilterId)];

    try {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        const prevMonth = month === 0 ? 11 : month - 1;
        const prevYear = month === 0 ? year - 1 : year;
        const thirtyDaysAgo = new Date(year, month, now.getDate() - 29);

        // 이번 달, 지난 달 날짜 범위 (문자열 비교용)
        const curMonthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
        const curMonthEnd = `${year}-${String(month + 1).padStart(2, '0')}-31`;
        const prevMonthStart = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-01`;
        const prevMonthEnd = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-31`;
        const recentDateStr = `${thirtyDaysAgo.getFullYear()}-${String(thirtyDaysAgo.getMonth() + 1).padStart(2, '0')}-${String(thirtyDaysAgo.getDate()).padStart(2, '0')}`;

        // 30일치 날짜 초기화
        const fuelDailyMap: Record<string, number> = {};
        const hipassDailyMap: Record<string, number> = {};
        for (let i = 0; i < 30; i++) {
            const d = new Date(thirtyDaysAgo);
            d.setDate(d.getDate() + i);
            const key = `${d.getMonth() + 1}/${d.getDate()}`;
            fuelDailyMap[key] = 0;
            hipassDailyMap[key] = 0;
        }

        const fuelCol = collection(db, 'fuelLogs');
        const hipassCol = collection(db, 'hipassCharges');

        const [fuelAgg, hipassAgg, fuelMonthAgg, hipassMonthAgg, fuelPrevMonthAgg, hipassPrevMonthAgg, fuelRecentSnap, hipassRecentSnap] = await Promise.all([
            getAggregateFromServer(query(fuelCol, ...orgScope), { totalCount: count(), totalCost: sum('fuelCost') }),
            getAggregateFromServer(query(hipassCol, ...orgScope), { totalCount: count(), totalAmount: sum('chargeAmount') }),
            getAggregateFromServer(query(fuelCol, ...orgScope, where('date', '>=', curMonthStart), where('date', '<=', curMonthEnd)), { monthCount: count(), monthCost: sum('fuelCost') }),
            getAggregateFromServer(query(hipassCol, ...orgScope, where('date', '>=', curMonthStart), where('date', '<=', curMonthEnd)), { monthCount: count(), monthAmount: sum('chargeAmount') }),
            getAggregateFromServer(query(fuelCol, ...orgScope, where('date', '>=', prevMonthStart), where('date', '<=', prevMonthEnd)), { prevCost: sum('fuelCost') }),
            getAggregateFromServer(query(hipassCol, ...orgScope, where('date', '>=', prevMonthStart), where('date', '<=', prevMonthEnd)), { prevAmount: sum('chargeAmount') }),
            getDocs(query(fuelCol, ...orgScope, where('date', '>=', recentDateStr), limit(DAILY_CHART_FETCH_MAX))),
            getDocs(query(hipassCol, ...orgScope, where('date', '>=', recentDateStr), limit(DAILY_CHART_FETCH_MAX))),
        ]);

        if (fuelRecentSnap.size >= DAILY_CHART_FETCH_MAX || hipassRecentSnap.size >= DAILY_CHART_FETCH_MAX) {
            console.warn(`[Dashboard] 일별 주유/하이패스 차트 조회가 상한(${DAILY_CHART_FETCH_MAX}건)에 도달 — 차트가 일부 누락될 수 있습니다.`);
        }

        // 주유 일별 집계 (최근 30일 문서만)
        fuelRecentSnap.docs.forEach(doc => {
            const data = doc.data();
            const dateStr = data.date as string;
            if (!dateStr) return;
            const [y, m, dd] = dateStr.split('-').map(Number);
            const parsed = new Date(y, m - 1, dd);
            if (parsed >= thirtyDaysAgo) {
                const key = `${parsed.getMonth() + 1}/${parsed.getDate()}`;
                if (fuelDailyMap[key] !== undefined) fuelDailyMap[key] += (data.fuelCost || 0);
            }
        });

        setFuelStats({
            totalCount: fuelAgg.data().totalCount,
            totalCost: fuelAgg.data().totalCost ?? 0,
            monthCount: fuelMonthAgg.data().monthCount,
            monthCost: fuelMonthAgg.data().monthCost ?? 0,
            prevMonthCost: fuelPrevMonthAgg.data().prevCost ?? 0,
        });
        setDailyFuelCost(Object.entries(fuelDailyMap).map(([date, cost]) => ({ date, cost })));

        // 하이패스 일별 집계 (최근 30일 문서만)
        hipassRecentSnap.docs.forEach(doc => {
            const data = doc.data();
            const dateStr = data.date as string;
            if (!dateStr) return;
            const [y, m, dd] = dateStr.split('-').map(Number);
            const parsed = new Date(y, m - 1, dd);
            if (parsed >= thirtyDaysAgo) {
                const key = `${parsed.getMonth() + 1}/${parsed.getDate()}`;
                if (hipassDailyMap[key] !== undefined) hipassDailyMap[key] += (data.chargeAmount || 0);
            }
        });

        setHipassStats({
            totalCount: hipassAgg.data().totalCount,
            totalAmount: hipassAgg.data().totalAmount ?? 0,
            monthCount: hipassMonthAgg.data().monthCount,
            monthAmount: hipassMonthAgg.data().monthAmount ?? 0,
            prevMonthAmount: hipassPrevMonthAgg.data().prevAmount ?? 0,
        });
        setDailyHipassAmount(Object.entries(hipassDailyMap).map(([date, amount]) => ({ date, amount })));
    } catch (err) {
        console.error('주유/하이패스 통계 로드 실패:', err);
    }
}
