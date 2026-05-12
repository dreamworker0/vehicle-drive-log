import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST = '';
initializeApp();
const db = getFirestore();

function getMinutes(startTime: string, endTime: string): number {
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    let mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins < 0) mins += 24 * 60; 
    return mins;
}

async function run() {
  const snap = await db.collection('driveLogs')
    .orderBy('timestamp', 'desc')
    .limit(500)
    .get();
    
  let daeun: any = null;
  let yeeun: any = null;

  snap.forEach(doc => {
    const data = doc.data();
    if (data.vehicleName?.includes('4371') || data.vehicleId === 'K3(4371)') {
        // Find specific logs from the screenshot
        if (data.driverName === '김다은' && data.startTime === '17:27' && data.endTime === '17:28') {
            daeun = { id: doc.id, ...data };
        }
        if (data.driverName === '김예은' && data.startTime === '17:28' && data.endTime === '20:43') {
            yeeun = { id: doc.id, ...data };
        }
    }
  });

  if (!daeun || !yeeun) {
      console.log('Target logs not found');
      return;
  }

  const totalDistance = yeeun.endKm - daeun.startKm;
  if (totalDistance < 0) {
      console.log('Total distance is negative, cannot distribute: ', totalDistance);
      return;
  }
  
  const daeunMins = getMinutes(daeun.startTime, daeun.endTime);
  const yeeunMins = getMinutes(yeeun.startTime, yeeun.endTime);
  const totalMins = daeunMins + yeeunMins;

  if (totalMins === 0) {
      console.log('Total minutes is 0, cannot distribute.');
      return;
  }

  const daeunDist = Math.round(totalDistance * (daeunMins / totalMins));
  const yeeunDist = totalDistance - daeunDist;

  const daeunEndKm = daeun.startKm + daeunDist;
  
  console.log(`[Before] 김다은: ${daeun.startKm} -> ${daeun.endKm} (dist: ${daeun.distance})`);
  console.log(`[Before] 김예은: ${yeeun.startKm} -> ${yeeun.endKm} (dist: ${yeeun.distance})`);
  console.log(`[Total] distance: ${totalDistance}km, minutes: ${totalMins}m`);
  console.log(`[After Calc] 김다은 dist: ${daeunDist}km, 김예은 dist: ${yeeunDist}km`);
  console.log(`[After] 김다은: ${daeun.startKm} -> ${daeunEndKm}`);
  console.log(`[After] 김예은: ${daeunEndKm} -> ${yeeun.endKm}`);

  const batch = db.batch();
  batch.update(db.collection('driveLogs').doc(daeun.id), {
      endKm: daeunEndKm,
      distance: daeunDist,
  });
  batch.update(db.collection('driveLogs').doc(yeeun.id), {
      startKm: daeunEndKm,
      distance: yeeunDist,
  });

  await batch.commit();
  console.log('Successfully applied proportional distances.');
}

run().then(() => process.exit(0)).catch(console.error);
