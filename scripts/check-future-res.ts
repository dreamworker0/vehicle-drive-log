import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// 임시 스크립트로 Firestore 문서 확인
const serviceAccount = JSON.parse(readFileSync(resolve('./serviceAccountKey.json'), 'utf8'));

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function check() {
  const docRef = db.doc('system/dashboardTimeSeries');
  const snap = await docRef.get();
  
  if (!snap.exists) {
    console.log("Document does not exist");
    return;
  }
  
  const data = snap.data();
  console.log("futureReservationTypeStats exists:", !!data.futureReservationTypeStats);
  if (data.futureReservationTypeStats) {
      console.log(JSON.stringify(data.futureReservationTypeStats).substring(0, 200) + '...');
  } else {
      // 어떤 필드들이 있는지 확인
      console.log("Available fields:", Object.keys(data).join(', '));
  }
  
  // 첫 번째 기관 문서도 확인
  const docs = await db.collection('system').limit(5).get();
  console.log("Docs in system:");
  docs.forEach(d => console.log(d.id));
}

check().catch(console.error);
