import { getFirestore } from 'firebase-admin/firestore';
import { initAdminApp } from './lib/adminApp';

// 자격증명(서비스 계정 키 → ADC)과 **대상 프로젝트 고정**은 lib/adminApp이 맡는다.
// 예전에는 실행 디렉터리의 serviceAccountKey.json만 봐서, 저장소 루트가 아닌 곳에서
// 실행하면 조회 자체가 불가능했다.
initAdminApp();

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
