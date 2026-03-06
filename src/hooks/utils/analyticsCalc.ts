/**
 * 분석(Analytics) 계산 유틸리티 — 순수 함수로 단위 테스트 가능
 */

export const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
export const MONTH_LABELS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

export interface LogEntry {
    date?: string;
    timestamp?: Date | { toDate?: () => Date };
    startTime?: string;
    departureTime?: string;
    startKm?: number;
    endKm?: number;
    fuelAmount?: number;
    energyCost?: number;
    driverName?: string;
    vehicleDisplayName?: string;
    vehicleName?: string;
}

interface TrendEntry {
    month: string;
    count: number;
    distance: number;
    fuelCost: number;
    label: string;
}

/**
 * Date 객체를 YYYY-MM 형식으로 변환
 */
export const formatMonth = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
};

/**
 * 로그에서 날짜 문자열(YYYY-MM-DD) 추출 — date 필드 우선, 없으면 timestamp 폴백
 */
export const getLogDate = (l: LogEntry) => {
    if (l.date) return l.date;
    const ts = l.timestamp;
    if (!ts) return '';
    const d = ts instanceof Date ? ts : ts.toDate?.();
    return d?.toISOString?.()?.slice(0, 10) || '';
};

/**
 * 최근 N개월의 월 키 목록 생성 (예: ['2025-09', '2025-10', ...])
 */
export function getRecentMonthKeys(monthCount = 6) {
    const keys: string[] = [];
    const now = new Date();
    for (let i = monthCount - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        keys.push(formatMonth(d));
    }
    return keys;
}

/**
 * 해당 월의 근무일 수 추정 (주말 제외, 공휴일 미포함)
 */
export function getWorkdaysInMonth(yearMonth: string) {
    const [y, m] = yearMonth.split('-').map(Number);
    const firstDay = new Date(y, m - 1, 1);
    const lastDay = new Date(y, m, 0);
    let count = 0;
    for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
        const dow = d.getDay();
        if (dow !== 0 && dow !== 6) count++;
    }
    return count;
}

/**
 * 월별 운행 추이를 계산한다.
 */
export function calcMonthlyTrend(logs: LogEntry[], monthKeys: string[]): TrendEntry[] {
    const map: Record<string, { month: string; count: number; distance: number; fuelCost: number }> = {};
    monthKeys.forEach(k => { map[k] = { month: k, count: 0, distance: 0, fuelCost: 0 }; });

    logs.forEach(l => {
        const d = getLogDate(l);
        if (!d) return;
        const mk = d.slice(0, 7);
        if (!map[mk]) return;
        map[mk].count++;
        map[mk].distance += ((l.endKm ?? 0) - (l.startKm ?? 0)) || 0;
        map[mk].fuelCost += l.fuelAmount || l.energyCost || 0;
    });

    return monthKeys.map(k => ({
        ...map[k],
        label: MONTH_LABELS[parseInt(k.split('-')[1], 10) - 1],
    }));
}

/**
 * 요일 × 시간대 히트맵 데이터를 계산한다.
 */
export function calcHeatmapData(logs: LogEntry[]) {
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);

    logs.forEach(l => {
        const d = getLogDate(l);
        const t = l.startTime || l.departureTime || '';
        if (!d || !t) return;
        const dayIdx = new Date(d).getDay();
        const hour = parseInt(t.split(':')[0], 10);
        if (!isNaN(hour) && hour >= 0 && hour < 24) {
            grid[dayIdx][hour]++;
        }
    });

    const result: { day: string; dayIdx: number; hour: number; count: number }[] = [];
    for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
        for (let hour = 0; hour < 24; hour++) {
            if (grid[dayIdx][hour] > 0) {
                result.push({
                    day: DAY_NAMES[dayIdx],
                    dayIdx,
                    hour,
                    count: grid[dayIdx][hour],
                });
            }
        }
    }
    return { grid, items: result, maxCount: Math.max(1, ...result.map(r => r.count)) };
}

/**
 * 비정상 운행을 탐지한다.
 */
export function detectAnomalies(logs: LogEntry[]) {
    const items: { type: string; icon: string; severity: string; title: string; desc: string }[] = [];

    // 주말 운행
    const weekendLogs = logs.filter(l => {
        const d = getLogDate(l);
        if (!d) return false;
        const dow = new Date(d).getDay();
        return dow === 0 || dow === 6;
    });
    const weekendRate = logs.length > 0
        ? Math.round((weekendLogs.length / logs.length) * 100) : 0;

    if (weekendRate > 15) {
        items.push({
            type: 'weekend',
            icon: '📅',
            severity: weekendRate > 30 ? 'high' : 'medium',
            title: `주말 운행 비율 ${weekendRate}%`,
            desc: `전체 ${logs.length}건 중 ${weekendLogs.length}건이 주말 운행입니다. 예약 정책 검토를 권장합니다.`,
        });
    }

    // 심야 운행 (22시~06시)
    const nightLogs = logs.filter(l => {
        const t = l.startTime || l.departureTime || '';
        if (!t) return false;
        const h = parseInt(t.split(':')[0], 10);
        return h >= 22 || h < 6;
    });
    if (nightLogs.length > 3) {
        items.push({
            type: 'night',
            icon: '🌙',
            severity: nightLogs.length > 10 ? 'high' : 'medium',
            title: `심야 운행 ${nightLogs.length}건 감지`,
            desc: `22시~06시 사이 운행이 ${nightLogs.length}건 발생했습니다.`,
        });
    }

    // 1일 과다 주행 (200km 이상)
    const dailyDist: Record<string, { driver: string; date: string; distance: number }> = {};
    logs.forEach(l => {
        const d = getLogDate(l);
        if (!d) return;
        const key = `${l.driverName || '?'}_${d}`;
        if (!dailyDist[key]) dailyDist[key] = { driver: l.driverName || '(이름 없음)', date: d, distance: 0 };
        dailyDist[key].distance += ((l.endKm ?? 0) - (l.startKm ?? 0)) || 0;
    });
    const overDrive = Object.values(dailyDist).filter(d => d.distance > 200);
    if (overDrive.length > 0) {
        items.push({
            type: 'overdrive',
            icon: '⚡',
            severity: overDrive.length > 5 ? 'high' : 'low',
            title: `1일 200km 이상 주행 ${overDrive.length}건`,
            desc: `장거리 운행이 빈번합니다. 운행 분담 또는 경로 최적화를 검토하세요.`,
        });
    }

    return items;
}
