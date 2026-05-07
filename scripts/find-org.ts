import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// firebase-admin 초기화 (credential 없이 애플리케이션 기본 자격 증명 사용 시도)
initializeApp();
const db = getFirestore();

async function findOrg() {
  // vehicles 중 displayName이나 plateNumber에 6285가 포함된 것 조회
  const vehiclesSnap = await db.collection('vehicles').get();
  
  let targetVehicle = null;
  vehiclesSnap.forEach(doc => {
    const data = doc.data();
    if ((data.displayName && data.displayName.includes('6285')) || 
        (data.plateNumber && data.plateNumber.includes('6285'))) {
      targetVehicle = data;
    }
  });

  if (!targetVehicle) {
    console.log("Vehicle 6285 not found.");
    
    // 사용자 이메일로 검색 시도
    console.log("Searching by email hj0610@bswin.net in employees...");
    // employees 컬렉션 그룹 쿼리
    const empSnap = await db.collectionGroup('employees').where('email', '==', 'hj0610@bswin.net').get();
    if (!empSnap.empty) {
        const emp = empSnap.docs[0].data();
        console.log("Found employee. organizationId:", emp.organizationId);
        if (emp.organizationId) {
            const orgDoc = await db.collection('organizations').doc(emp.organizationId).get();
            if (orgDoc.exists) {
                console.log("Organization Name:", orgDoc.data()?.name);
            }
        }
    }
    return;
  }

  console.log("Found Vehicle:", targetVehicle.displayName, targetVehicle.plateNumber);
  console.log("Organization ID:", targetVehicle.organizationId);

  if (targetVehicle.organizationId) {
    const orgDoc = await db.collection('organizations').doc(targetVehicle.organizationId).get();
    if (orgDoc.exists) {
      console.log("Organization Name:", orgDoc.data()?.name);
    } else {
      console.log("Organization document not found.");
    }
  }
}

findOrg().catch(console.error);
