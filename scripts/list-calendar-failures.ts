/**
 * list-calendar-failures — 캘린더 동기화 실패 차량 목록 추출 (읽기 전용)
 *
 * googleCalendarId가 연동된 차량 중 calendarSyncFailCount가 쌓인 차량을
 * 영구중단(>=10) / 쿨다운(3~9)으로 분류하고, 영구중단 차량의 소속 기관별로
 * 관리자 이메일(users role=admin + organizations.adminEmail)을 모아
 * 공유 설정 안내 발송용 CSV를 생성한다.
 *
 * 인증은 GOOGLE_APPLICATION_CREDENTIALS(ADC)를 사용한다. 쓰기 없음.
 * 실행: fnm exec --using=22 npx tsx scripts/list-calendar-failures.ts
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

interface Row {
    orgId: string;
    orgName: string;
    vehicleId: string;
    vehicleName: string;
    calendarId: string;
    failCount: number;
    lastFailAt: string;
}

interface OrgInfo {
    name: string;
    adminEmail: string;        // organizations.adminEmail (선택 입력)
    adminUserEmails: string[]; // users where role=admin
}

const csvCell = (v: string) => `"${(v ?? '').replace(/"/g, '""')}"`;

async function main() {
    const snap = await db.collection('vehicles').where('googleCalendarId', '!=', '').get();

    const permanent: Row[] = [];
    const cooldown: Row[] = [];
    const orgInfoCache = new Map<string, OrgInfo>();

    async function getOrgInfo(orgId: string): Promise<OrgInfo> {
        if (!orgId) return { name: '(미상)', adminEmail: '', adminUserEmails: [] };
        if (orgInfoCache.has(orgId)) return orgInfoCache.get(orgId)!;

        let name = orgId;
        let adminEmail = '';
        try {
            const od = await db.collection('organizations').doc(orgId).get();
            const d = od.data();
            name = (d?.name as string) || orgId;
            adminEmail = (d?.adminEmail as string) || '';
        } catch { /* 무시 */ }

        let adminUserEmails: string[] = [];
        try {
            const us = await db.collection('users')
                .where('organizationId', '==', orgId)
                .where('role', '==', 'admin')
                .get();
            adminUserEmails = us.docs
                .map(u => (u.data().email as string) || '')
                .filter(Boolean);
        } catch { /* 무시 */ }

        const info: OrgInfo = { name, adminEmail, adminUserEmails };
        orgInfoCache.set(orgId, info);
        return info;
    }

    for (const doc of snap.docs) {
        const d = doc.data();
        const failCount = (d.calendarSyncFailCount as number) || 0;
        if (failCount < 3) continue;

        const lastFail = d.calendarSyncLastFailAt;
        const lastFailAt = lastFail?.toDate
            ? lastFail.toDate().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
            : '기록 없음';

        const orgId = (d.organizationId as string) || '';
        const info = await getOrgInfo(orgId);

        const row: Row = {
            orgId,
            orgName: info.name,
            vehicleId: doc.id,
            vehicleName: (d.displayName as string) || '(이름없음)',
            calendarId: (d.googleCalendarId as string) || '',
            failCount,
            lastFailAt,
        };
        (failCount >= 10 ? permanent : cooldown).push(row);
    }

    const sortByOrg = (a: Row, b: Row) => a.orgName.localeCompare(b.orgName, 'ko');
    permanent.sort(sortByOrg);
    cooldown.sort(sortByOrg);

    const print = (title: string, rows: Row[]) => {
        console.log(`\n===== ${title} (${rows.length}대) =====`);
        for (const r of rows) {
            console.log(
                `- [${r.orgName}] ${r.vehicleName} | 실패 ${r.failCount}회 | 마지막 ${r.lastFailAt}\n` +
                `    calendarId: ${r.calendarId}\n` +
                `    orgId=${r.orgId} vehicleId=${r.vehicleId}`
            );
        }
    };

    console.log(`연동 차량 총 ${snap.size}대 중, 실패 누적(>=3) 차량을 분류합니다.`);
    print('영구중단 (failCount >= 10, 수동 리셋 필요)', permanent);
    print('쿨다운 (failCount 3~9, 24h 후 자동 재시도)', cooldown);

    // 기관별 영구중단 집계 (관리자 이메일 포함)
    const byOrg = new Map<string, { orgId: string; count: number; vehicles: Row[] }>();
    for (const r of permanent) {
        const e = byOrg.get(r.orgId) || { orgId: r.orgId, count: 0, vehicles: [] };
        e.count++;
        e.vehicles.push(r);
        byOrg.set(r.orgId, e);
    }

    console.log(`\n===== 기관별 영구중단 집계 + 관리자 이메일 =====`);
    const sortedOrgs = [...byOrg.values()].sort((a, b) => b.count - a.count);
    const csvLines: string[] = [
        ['기관명', 'orgId', '영구중단대수', '관리자이메일(users)', '기관adminEmail', '차량목록', '대표캘린더ID'].map(csvCell).join(','),
    ];
    for (const e of sortedOrgs) {
        const info = orgInfoCache.get(e.orgId)!;
        const adminUsers = info.adminUserEmails.join('; ');
        const vehicles = e.vehicles.map(v => `${v.vehicleName}(${v.failCount}회)`).join('; ');
        const repCal = e.vehicles[0]?.calendarId || '';
        console.log(`- ${info.name} (${e.count}대) | 관리자: ${adminUsers || '(없음)'} | adminEmail: ${info.adminEmail || '(없음)'}`);
        csvLines.push([
            info.name, e.orgId, String(e.count), adminUsers, info.adminEmail, vehicles, repCal,
        ].map(csvCell).join(','));
    }

    // CSV 저장 (UTF-8 BOM으로 Excel 한글 깨짐 방지). 출력 경로는 인자로 지정 가능.
    const outPath = resolve(process.argv[2] || './calendar-failures.csv');
    writeFileSync(outPath, '﻿' + csvLines.join('\r\n'), 'utf8');
    console.log(`\nCSV 저장: ${outPath}`);
    console.log(`요약: 영구중단 ${permanent.length}대 / ${byOrg.size}개 기관 / 쿨다운 ${cooldown.length}대`);
}

main().catch((e) => { console.error(e); process.exit(1); });
