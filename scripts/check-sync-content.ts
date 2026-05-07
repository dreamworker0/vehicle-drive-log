import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp();
const db = getFirestore();

async function checkSyncContent() {
  console.log("=== Checking Calendar Sync Content for Non-Vehicle Events ===");
  
  // 1. 차량 -> 기관 매핑
  const vehiclesSnap = await db.collection('vehicles').get();
  const vehicleToOrg: Record<string, string> = {};
  const orgNames: Record<string, string> = {};
  vehiclesSnap.forEach(doc => {
    vehicleToOrg[doc.id] = doc.data().organizationId;
  });

  // 2. 기관 ID -> 기관명 매핑
  const orgsSnap = await db.collection('organizations').get();
  orgsSnap.forEach(doc => {
    orgNames[doc.id] = doc.data().name;
  });

  // 3. 최근 3개월 예약 데이터
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const reservationsSnap = await db.collection('reservations')
    .where('createdAt', '>=', threeMonthsAgo)
    .get();

  const suspiciousKeywords = ['연차', '반차', '휴가', '병가', '휴무', '회의', '교육', '워크샵', '세미나', '간담회', '사은회', 'OT', 'OT)', '미팅'];
  
  // 기관별로 의심스러운 일정 목록 저장
  const orgSuspiciousEvents: Record<string, string[]> = {};
  const orgTotalSyncs: Record<string, number> = {};

  reservationsSnap.forEach(doc => {
    const data = doc.data();
    if (data.syncSource === 'calendar') {
      const orgId = vehicleToOrg[data.vehicleId];
      if (!orgId) return;
      
      orgTotalSyncs[orgId] = (orgTotalSyncs[orgId] || 0) + 1;

      // 보통 purpose나 destination에 캘린더 제목이 들어감
      const title1 = String(data.purpose || '');
      const title2 = String(data.destination || '');
      const title3 = String(data.reservedByName || '');
      const fullText = `${title1} ${title2} ${title3}`;

      const isSuspicious = suspiciousKeywords.some(kw => fullText.includes(kw));

      if (isSuspicious) {
        if (!orgSuspiciousEvents[orgId]) {
          orgSuspiciousEvents[orgId] = [];
        }
        // 목적이나 목적지가 캘린더 제목일 확률이 큼
        const eventSummary = data.purpose && data.purpose.length > 2 ? data.purpose : (data.destination || fullText);
        
        // 날짜 포맷팅 (Timestamp 혹은 string)
        const getFormattedDate = (val: unknown, options?: Intl.DateTimeFormatOptions) => {
          if (!val) return '알수없음';
          let d: Date;
          if (typeof val === 'object' && val !== null && 'toDate' in val && typeof (val as Record<string, unknown>).toDate === 'function') {
            d = ((val as Record<string, unknown>).toDate as () => Date)();
          } else {
            d = new Date(val as string | number | Date);
          }
          return isNaN(d.getTime()) ? '알수없음' : d.toLocaleDateString('ko-KR', options);
        };

        const createdDate = getFormattedDate(data.createdAt);
        const startDate = getFormattedDate(data.startTime, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        
        orgSuspiciousEvents[orgId].push(`[일정: ${startDate} | 등록: ${createdDate}] ${eventSummary}`);
      }
    }
  });

  // 4. 결과 출력
  console.log("\n[의심되는 일정이 발견된 기관들 (연차, 휴가, 회의 등 포함)]\n");
  for (const orgId of Object.keys(orgSuspiciousEvents)) {
    const orgName = orgNames[orgId] || 'Unknown Org';
    const totalCount = orgTotalSyncs[orgId];
    const suspiciousCount = orgSuspiciousEvents[orgId].length;
    
    // 전체 동기화 건수 대비 의심 건수가 10% 이상이거나, 의심 건수가 2건 이상인 경우
    if (suspiciousCount > 0) {
      console.log(`- ${orgName} (${suspiciousCount}건 / 전체 동기화 ${totalCount}건)`);
      // 샘플 최대 10개 출력 (더 자세히 보기 위해 증가)
      const samples = orgSuspiciousEvents[orgId].slice(0, 10);
      samples.forEach(s => console.log(`  └ ${s}`));
      if (orgSuspiciousEvents[orgId].length > 10) {
        console.log(`  └ ...외 ${orgSuspiciousEvents[orgId].length - 10}건 더 있음`);
      }
      console.log("");
    }
  }
}

checkSyncContent().catch(console.error);
