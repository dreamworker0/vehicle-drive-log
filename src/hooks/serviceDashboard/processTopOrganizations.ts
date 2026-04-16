import {
    FUEL_LABELS, FUEL_COLORS, VT_LABELS, VT_COLORS,
    computeDistance, computeDuration,
} from '../../components/superAdmin/dashboard/dashboardUtils';
import type { SharedSnaps, OrgStat, TopOrganizationsSetters } from './types';

/**
 * 기관별 활성도 + 차량 유형 + 월별 성장 + 첫 직원 등록 소요시간
 */
export async function processTopOrganizations(
    shared: SharedSnaps,
    setters: TopOrganizationsSetters,
): Promise<void> {
    const { orgSnap, logSnap, userSnap, vehicleSnap, hipassCardSnap } = shared;
    const {
        setTopOrgs, setStats, setHipassRatio, setCalendarSyncRatio,
        setHipassTopOrgs, setFuelTypeStats, setVehicleTypeStats,
        setVehicleModelStats, setOrgAvgDuration, setMonthlyGrowth,
        setFirstEmployeeStats, setFirstEmployeeDist, setFirstEmployeeTrend,
    } = setters;

    try {
        const orgMap: Record<string, OrgStat> = {};
        const approvalList: { id: string; name: string; approvedAt: Date; applicantName: string | null; applicantEmail: string | null }[] = [];
        const firstEmpDaysList: { days: number; approvedAt: Date }[] = [];
        orgSnap.docs.forEach(doc => {
            const data = doc.data();
            if (data.deletedAt || data.status !== 'approved') return;
            orgMap[doc.id] = { id: doc.id, name: data.name || '이름 없음', address: data.address || data.aiVerifyDetail?.address || '', lat: data.lat || 0, lng: data.lng || 0, logs: 0, users: 0, vehicles: 0, distance: 0, lastDriveDate: null, totalDuration: 0, durationCount: 0 };
            if (data.approvedAt) {
                const approvedDate = data.approvedAt?.toDate ? data.approvedAt.toDate() : new Date(data.approvedAt);
                if (!isNaN(approvedDate.getTime())) {
                    approvalList.push({
                        id: doc.id,
                        name: data.name || '이름 없음',
                        approvedAt: approvedDate,
                        applicantName: data.applicantName || null,
                        applicantEmail: data.applicantEmail || null,
                    });
                }
            }
            if (data.timeToFirstEmployeeDays != null && data.approvedAt) {
                const approvedDate = data.approvedAt?.toDate ? data.approvedAt.toDate() : new Date(data.approvedAt);
                if (!isNaN(approvedDate.getTime())) {
                    firstEmpDaysList.push({ days: data.timeToFirstEmployeeDays, approvedAt: approvedDate });
                }
            }
        });

        logSnap.docs.forEach(doc => {
            const data = doc.data();
            if (data.organizationId && orgMap[data.organizationId]) {
                orgMap[data.organizationId].logs++;
                const dist = computeDistance(data);
                orgMap[data.organizationId].distance += dist;
                const ts = data.timestamp?.toDate ? data.timestamp.toDate() : (data.timestamp ? new Date(data.timestamp) : null);
                if (ts) {
                    const prev = orgMap[data.organizationId].lastDriveDate;
                    if (!prev || ts > prev) orgMap[data.organizationId].lastDriveDate = ts;
                }
                const dur = computeDuration(data.startTime, data.endTime);
                if (dur > 0) {
                    orgMap[data.organizationId].totalDuration += dur;
                    orgMap[data.organizationId].durationCount++;
                }
            }
        });

        userSnap.docs.forEach(doc => {
            const data = doc.data();
            if (data.organizationId && orgMap[data.organizationId] && data.role !== 'superAdmin') {
                orgMap[data.organizationId].users++;
            }
        });

        // 연료 유형 + 차량 유형 + 모델 집계
        const fuelMap: Record<string, number> = {};
        const vtMap: Record<string, number> = {};
        const modelMap: Record<string, number> = {};
        let calendarSyncCount = 0;
        let calendarNotSyncCount = 0;
        const calendarSyncOrgSet = new Set<string>();

        vehicleSnap.docs.forEach(doc => {
            const data = doc.data();
            if (data.organizationId && orgMap[data.organizationId]) {
                orgMap[data.organizationId].vehicles++;
            }

            if (data.googleCalendarId) {
                calendarSyncCount++;
                if (data.organizationId) {
                    calendarSyncOrgSet.add(data.organizationId);
                }
            } else {
                calendarNotSyncCount++;
            }

            const ft = (data.fuelType as string) || 'gasoline';
            fuelMap[ft] = (fuelMap[ft] || 0) + 1;
            const vt = (data.vehicleType as string) || 'sedan';
            vtMap[vt] = (vtMap[vt] || 0) + 1;
            const model = (data.modelName as string) || (data.displayName as string) || (data.name as string) || '알 수 없음';
            modelMap[model] = (modelMap[model] || 0) + 1;
        });

        // 하이패스 집계 (hipassCards 컬렉션 기반)
        const hipassVehicleSet = new Set<string>();
        const orgHipassMap: Record<string, number> = {};
        hipassCardSnap.docs.forEach(doc => {
            const data = doc.data();
            if (data.vehicleId) {
                hipassVehicleSet.add(data.vehicleId);
            }
            if (data.organizationId && orgMap[data.organizationId]) {
                const orgName = orgMap[data.organizationId].name;
                orgHipassMap[orgName] = (orgHipassMap[orgName] || 0) + 1;
            }
        });
        const hipassWithCount = hipassVehicleSet.size;
        const hipassTotalCount = vehicleSnap.size;

        setHipassRatio({ withHipass: hipassWithCount, withoutHipass: hipassTotalCount - hipassWithCount });
        setCalendarSyncRatio({ sync: calendarSyncCount, notSync: calendarNotSyncCount });
        setStats(prev => prev ? { ...prev, calendarSyncOrgs: calendarSyncOrgSet.size } : null);

        setHipassTopOrgs(
            Object.entries(orgHipassMap)
                .map(([name, c]) => ({ name, count: c }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 5)
        );

        setFuelTypeStats(
            Object.entries(fuelMap)
                .map(([type, c]) => ({
                    type,
                    label: FUEL_LABELS[type] || type,
                    count: c,
                    color: FUEL_COLORS[type] || '#9ca3af',
                }))
                .sort((a, b) => b.count - a.count)
        );

        setVehicleTypeStats(
            Object.entries(vtMap)
                .map(([type, c]) => ({
                    type,
                    label: VT_LABELS[type] || type,
                    count: c,
                    color: VT_COLORS[type] || '#9ca3af',
                }))
                .sort((a, b) => b.count - a.count)
        );

        setVehicleModelStats(
            Object.entries(modelMap)
                .map(([model, c]) => ({ model, count: c }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 15)
        );

        const orgList = Object.values(orgMap);
        setTopOrgs(orgList);

        const orgDurList = orgList
            .filter((o) => o.durationCount >= 10)
            .map((o) => ({ name: o.name, avg: Math.round(o.totalDuration / o.durationCount) }))
            .sort((a, b) => b.avg - a.avg)
            .slice(0, 15);
        setOrgAvgDuration(orgDurList);

        approvalList.sort((a, b) => b.approvedAt.getTime() - a.approvedAt.getTime());

        // 월별 누적 기관 증가 추이
        if (approvalList.length > 0) {
            const monthMap: Record<string, number> = {};
            const sorted = [...approvalList].sort((a, b) => a.approvedAt.getTime() - b.approvedAt.getTime());
            sorted.forEach(org => {
                const key = `${org.approvedAt.getFullYear()}.${(org.approvedAt.getMonth() + 1).toString().padStart(2, '0')}`;
                monthMap[key] = (monthMap[key] || 0) + 1;
            });
            const months = Object.keys(monthMap).sort();
            let cumulative = 0;
            const growth = months.map(m => {
                cumulative += monthMap[m];
                return { month: m, cumulative };
            });
            setMonthlyGrowth(growth);
        }

        // ── 첫 직원 등록 소요시간 통계 계산 ──
        if (firstEmpDaysList.length > 0) {
            const dayValues = firstEmpDaysList.map(d => d.days).sort((a, b) => a - b);
            const total = dayValues.length;
            const avg = Math.round(dayValues.reduce((s, v) => s + v, 0) / total * 10) / 10;
            const median = total % 2 === 0
                ? (dayValues[total / 2 - 1] + dayValues[total / 2]) / 2
                : dayValues[Math.floor(total / 2)];
            const sameDayCount = dayValues.filter(d => d === 0).length;
            const sameDayRate = Math.round((sameDayCount / total) * 100);

            setFirstEmployeeStats({ avg, median, sameDayRate, total });

            const buckets = [
                { label: '당일', min: 0, max: 0, color: '#22c55e' },
                { label: '1일', min: 1, max: 1, color: '#3b82f6' },
                { label: '2~3일', min: 2, max: 3, color: '#6366f1' },
                { label: '4~7일', min: 4, max: 7, color: '#8b5cf6' },
                { label: '8~14일', min: 8, max: 14, color: '#f59e0b' },
                { label: '15~30일', min: 15, max: 30, color: '#f97316' },
                { label: '30일+', min: 31, max: Infinity, color: '#ef4444' },
            ];
            setFirstEmployeeDist(
                buckets.map(b => ({
                    label: b.label,
                    count: dayValues.filter(d => d >= b.min && d <= b.max).length,
                    color: b.color,
                }))
            );

            const monthAvgMap: Record<string, number[]> = {};
            firstEmpDaysList.forEach(({ days, approvedAt: aDate }) => {
                const key = `${aDate.getFullYear()}.${(aDate.getMonth() + 1).toString().padStart(2, '0')}`;
                if (!monthAvgMap[key]) monthAvgMap[key] = [];
                monthAvgMap[key].push(days);
            });
            const trendMonths = Object.keys(monthAvgMap).sort();
            setFirstEmployeeTrend(
                trendMonths.map(m => ({
                    month: m,
                    avg: Math.round(monthAvgMap[m].reduce((s, v) => s + v, 0) / monthAvgMap[m].length * 10) / 10,
                }))
            );
        }
    } catch (err) {
        console.error('기관 활성도 로드 실패:', err);
    }
}
