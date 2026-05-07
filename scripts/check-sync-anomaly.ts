import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// 서비스 어카운트 로드
const serviceAccount = JSON.parse(readFileSync(resolve('./serviceAccountKey.json'), 'utf8'));

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function checkSyncAnomaly() {
  console.log("=== Checking recent reservations (last 3 hours) ===");
  const now = new Date();
  const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);

  // Firestore에서 reservations 컬렉션 조회
  const snapshot = await db.collection('reservations')
    .where('createdAt', '>=', threeHoursAgo)
    .orderBy('createdAt', 'desc')
    .get();

  if (snapshot.empty) {
    console.log("No reservations found in the last 3 hours.");
    return;
  }

  console.log(`Found ${snapshot.size} reservations created in the last 3 hours.\n`);

  snapshot.forEach(doc => {
    const data = doc.data();
    const createdAt = data.createdAt ? data.createdAt.toDate().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : 'Unknown';
    console.log(`- ID: ${doc.id}`);
    console.log(`  Vehicle: ${data.vehicleId} | User: ${data.reservedByName || data.reservedByUid || 'Unknown'}`);
    console.log(`  Date: ${data.date} ${data.startTime}~${data.endTime}`);
    console.log(`  Created At: ${createdAt}`);
    console.log(`  Sync Source: ${data.syncSource || 'app'}`);
    console.log(`  Purpose: ${data.purpose || ''}`);
    console.log(`  Event ID: ${data.calendarEventId || 'none'}\n`);
  });
}

checkSyncAnomaly().catch(console.error);
