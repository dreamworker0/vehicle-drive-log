import fs from 'fs';

const path = './functions/src/caching/computeDashboardStats.ts';
let code = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

// Promise.all 까지 찾기 (라인 73)
const splitPoint1 = '    ]);\n\n    // ── 2. 기관 기초 데이터 ──';
const parts1 = code.split(splitPoint1);
if (parts1.length < 2) {
    console.error("splitPoint1 not found");
    process.exit(1);
}

// batch.set 전까지 찾기 (라인 598)
const splitPoint2 = '    // ── 10. Firestore에 3개 문서 batch write ──';
const parts2 = parts1[1].split(splitPoint2);
if (parts2.length < 2) {
    console.error("splitPoint2 not found");
    process.exit(1);
}

const preCode = parts1[0] + '    ]);\n';
let bodyCode = '    // ── 2. 기관 기초 데이터 ──' + parts2[0];
const postCode = '    // ── 10. Firestore에 문서 분할 쓰기 ──\n' + parts2[1];

// bodyCode 안에 있는 snap루프에 orgFilterId 처리를 넣습니다.
bodyCode = bodyCode.replace(
    'orgSnap.docs.forEach(doc => {\n        const data = doc.data();',
    'orgSnap.docs.forEach(doc => {\n        if (orgFilterId && doc.id !== orgFilterId) return;\n        const data = doc.data();'
);

bodyCode = bodyCode.replace(
    'userSnap.docs.forEach(doc => {\n        const data = doc.data();',
    'userSnap.docs.forEach(doc => {\n        const data = doc.data();\n        if (orgFilterId && data.organizationId !== orgFilterId) return;'
);

bodyCode = bodyCode.replace(
    'userSnap.docs.forEach(doc => {\n        const data = doc.data();\n        if (data.role !== "superAdmin"',
    'userSnap.docs.forEach(doc => {\n        const data = doc.data();\n        if (orgFilterId && data.organizationId !== orgFilterId) return;\n        if (data.role !== "superAdmin"'
);

bodyCode = bodyCode.replace(
    'logSnap.docs.forEach(doc => {\n        const data = doc.data();',
    'logSnap.docs.forEach(doc => {\n        const data = doc.data();\n        if (orgFilterId && data.organizationId !== orgFilterId) return;'
);

// reservationSnap은 calendar 중복 체크 로직이 있으므로 조금 다름
bodyCode = bodyCode.replace(
    'reservationSnap.docs.forEach(doc => {\n        const data = doc.data();',
    'reservationSnap.docs.forEach(doc => {\n        const data = doc.data();\n        if (orgFilterId && data.organizationId !== orgFilterId) return;'
);

bodyCode = bodyCode.replace(
    'vehicleSnap.docs.forEach(doc => {\n        const data = doc.data();',
    'vehicleSnap.docs.forEach(doc => {\n        const data = doc.data();\n        if (orgFilterId && data.organizationId !== orgFilterId) return;'
);

bodyCode = bodyCode.replace(
    'hipassCardSnap.docs.forEach(doc => {\n        const data = doc.data();',
    'hipassCardSnap.docs.forEach(doc => {\n        const data = doc.data();\n        if (orgFilterId && data.organizationId !== orgFilterId) return;'
);

bodyCode = bodyCode.replace(
    'orgListFiltered.forEach(o => {',
    'orgListFiltered.forEach(o => {\n        if (orgFilterId && o.id !== orgFilterId) return;'
);

// 정규식으로 찾아서 변경 (orgListFiltered.filter(...) 부분)
bodyCode = bodyCode.replace(
    /orgListFiltered\.filter\(o => o\.createdAt && o\.createdAt >= dayStart && o\.createdAt <= dayEnd\)\.forEach\(o => \{/g,
    'orgListFiltered.filter(o => o.createdAt && o.createdAt >= dayStart && o.createdAt <= dayEnd).forEach(o => {\n            if (orgFilterId && o.id !== orgFilterId) return;'
);

// 반환문
bodyCode = bodyCode + `

    return {
        dashboardStats: {
            approvedOrgs, totalUsers, adminCount, employeeCount, totalLogs, totalDistance: Math.round(totalDistance),
            pendingApps: orgFilterId ? 0 : pendingAppSnap.data().count,
            calendarSyncOrgs: calendarSyncOrgSet.size, calendarSyncVehicles: calendarSyncCount,
            calendarNotSyncVehicles: calendarNotSyncCount,
            fuelTypeStats: Object.entries(fuelMap).map(([type, count]) => ({ type, label: FUEL_LABELS[type] || type, count, color: FUEL_COLORS[type] || "#9ca3af" })).sort((a, b) => b.count - a.count),
            vehicleTypeStats: Object.entries(vtMap).map(([type, count]) => ({ type, label: VT_LABELS[type] || type, count, color: VT_COLORS[type] || "#9ca3af" })).sort((a, b) => b.count - a.count),
            vehicleModelStats: Object.entries(modelMap).map(([model, count]) => ({ model, count })).sort((a, b) => b.count - a.count).slice(0, 15),
            hipassRatio: { withHipass: hipassWithCount, withoutHipass: hipassTotalCount - hipassWithCount },
            hipassTopOrgs: Object.entries(orgHipassMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 5),
            calendarSyncRatio: { sync: calendarSyncCount, notSync: calendarNotSyncCount },
            calendarTopOrgs: Object.entries(orgCalendarMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 10),
            favoriteUserRatio: { total: totalUsers, withFavorite: withFavCount, rate: totalUsers > 0 ? Math.round((withFavCount / totalUsers) * 100) : 0 },
            weeklyActiveRate: { active: wauSet.size, total: totalUsers },
            monthlyGrowth, themeStats: { dark: darkCount, light: lightCount, none: noneCount },
            welcomeStats: { dismissed: welcomeDismissedCount, notDismissed: welcomeNotDismissedCount, rate: totalUsers > 0 ? Math.round((welcomeDismissedCount / totalUsers) * 100) : 0 },
            monthlyStats: { monthLabel: \`\${year}년 \${month + 1}월\`, logs: monthLogs, distance: Math.round(monthDistance), activeUsers: monthActiveUsers.size, prevLogs, prevDistance: Math.round(prevDistance), prevActiveUsers: prevMonthActiveUsers.size },
            firstEmployeeStats, firstEmployeeDist, firstEmployeeTrend,
            onboardingStats: { total: totalOrgsCount, completed: onboardingCompleted, rate: totalOrgsCount > 0 ? Math.round((onboardingCompleted / totalOrgsCount) * 100) : 0 },
            orgSizeDistribution, lastUpdatedAt: new Date().toISOString(), computeDurationMs: Date.now() - startTime
        },
        dashboardTimeSeries: {
            dailyDriveStats, dailyActiveUserStats, dailyActiveOrgStats: dailyOrgData, inputMethodStats, favoriteStats: favoriteStatsArr,
            dailyAvgDuration, hourlyStats, hourlyAvgDuration, heatmapData: { items: heatItems, maxCount: Math.max(1, ...heatItems.map(i => i.count)) },
            favoriteLogRatio: { total: favTotal, favorite: totalFav, normal: totalNorm, rate: favTotal > 0 ? Math.round((totalFav / favTotal) * 100) : 0 },
            quickDriveStats, quickDriveRatio, recommendationStats, recommendationRatio, reservationTypeStats, reservationTypeRatio,
            lastUpdatedAt: new Date().toISOString()
        },
        dashboardOrgRankings: {
            topOrgs, orgAvgDuration, funnelData, lastUpdatedAt: new Date().toISOString()
        }
    };
`;

// 감싸기 (줄바꿈 교정)
const wrappedBody = '    function buildStats(orgFilterId: string | null) {\n' + 
      bodyCode.split('\n').map(line => '        ' + line).join('\n') + '\n' +
      '    }\n';

const finalPostCode = `
    const allStats = buildStats(null);
    
    // Batch Commits (Chunk size 400)
    const writeChunks: {docRef: any, data: any}[] = [];
    writeChunks.push({ docRef: db.doc("system/dashboardStats"), data: allStats.dashboardStats });
    writeChunks.push({ docRef: db.doc("system/dashboardTimeSeries"), data: allStats.dashboardTimeSeries });
    writeChunks.push({ docRef: db.doc("system/dashboardOrgRankings"), data: allStats.dashboardOrgRankings });

    // 각 승인된 기관별 캐시 생성
    const approvedOrgs = allStats.dashboardOrgRankings.topOrgs;
    for (const org of approvedOrgs) {
        const orgStats = buildStats(org.id);
        writeChunks.push({ docRef: db.doc(\`system/dashboardStats_\${org.id}\`), data: orgStats.dashboardStats });
        writeChunks.push({ docRef: db.doc(\`system/dashboardTimeSeries_\${org.id}\`), data: orgStats.dashboardTimeSeries });
    }

    const chunkLimit = 400;
    for (let i = 0; i < writeChunks.length; i += chunkLimit) {
        const chunk = writeChunks.slice(i, i + chunkLimit);
        const batch = db.batch();
        chunk.forEach(w => batch.set(w.docRef, w.data));
        await batch.commit();
    }

    const elapsed = Date.now() - startTime;
    console.log(\`[computeDashboardStats] 완료: \${elapsed}ms, orgs=\${allStats.dashboardStats.approvedOrgs}, logs=\${allStats.dashboardStats.totalLogs}, users=\${allStats.dashboardStats.totalUsers}, dbWrites=\${writeChunks.length}\`);
}
`;

fs.writeFileSync(path, preCode + wrappedBody + finalPostCode, 'utf8');
console.log('Refactoring applied!');
