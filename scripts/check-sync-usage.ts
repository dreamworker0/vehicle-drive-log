import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// firebase-admin 초기화
initializeApp();
const db = getFirestore();

async function checkSyncUsage() {
  console.log("=== Checking Calendar Sync Usage ===");
  
  // 모든 차량 데이터를 가져와서 vehicleId -> organizationId 매핑 생성
  const vehiclesSnap = await db.collection('vehicles').get();
  const vehicleToOrg: Record<string, string> = {};
  vehiclesSnap.forEach(doc => {
    vehicleToOrg[doc.id] = doc.data().organizationId;
  });

  // 예약 데이터 중 최근 3개월 치만 조회 (너무 많을 수 있으므로 제한)
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const reservationsSnap = await db.collection('reservations')
    .where('createdAt', '>=', threeMonthsAgo)
    .get();

  const orgUsageCount: Record<string, number> = {};
  let totalCalendarSyncs = 0;

  reservationsSnap.forEach(doc => {
    const data = doc.data();
    if (data.syncSource === 'calendar') {
      totalCalendarSyncs++;
      const orgId = vehicleToOrg[data.vehicleId];
      if (orgId) {
        orgUsageCount[orgId] = (orgUsageCount[orgId] || 0) + 1;
      }
    }
  });

  console.log(`\nTotal calendar-synced reservations in the last 3 months: ${totalCalendarSyncs}`);
  console.log(`Number of organizations using reverse sync: ${Object.keys(orgUsageCount).length}\n`);

  // 기관명 가져와서 출력
  for (const orgId of Object.keys(orgUsageCount)) {
    const orgDoc = await db.collection('organizations').doc(orgId).get();
    const orgName = orgDoc.exists ? orgDoc.data()?.name : 'Unknown Org';
    console.log(`- ${orgName} (${orgId}): ${orgUsageCount[orgId]} reservations`);
  }
}

checkSyncUsage().catch(console.error);
