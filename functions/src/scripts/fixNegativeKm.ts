import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST = ''; // Ensure prod/default is targeted if necessary
initializeApp();
const db = getFirestore();

async function run() {
  console.log('Finding corrupted drive logs...');
  const logsSnap = await db.collection('driveLogs').get();
  let count = 0;
  let batch = db.batch();
  
  for (const doc of logsSnap.docs) {
    const data = doc.data();
    let updated = false;
    let newStartKm = data.startKm;
    let newEndKm = data.endKm;

    if (newStartKm != null && newStartKm < 0) {
      newStartKm = 0;
      updated = true;
    }
    if (newEndKm != null && newEndKm < 0) {
      newEndKm = 0;
      updated = true;
    }
    
    if (newStartKm != null && newEndKm != null && data.distance != null) {
      if (newEndKm < newStartKm || newEndKm - newStartKm !== data.distance) {
         newEndKm = newStartKm + data.distance;
         updated = true;
      }
    }

    if (updated) {
      console.log(`Fixing Log ${doc.id}: start=${data.startKm}(->${newStartKm}), end=${data.endKm}(->${newEndKm})`);
      batch.update(doc.ref, { startKm: newStartKm, endKm: newEndKm });
      count++;
      
      if (count % 400 === 0) {
         await batch.commit();
         batch = db.batch();
      }
    }
  }
  
  if (count > 0) {
     await batch.commit();
  }
  batch = db.batch();
  console.log(`Fixed ${count} drive logs.`);

  // Fix Vehicles currentKm
  console.log('Finding corrupted vehicles...');
  const vehiclesSnap = await db.collection('vehicles').get();
  let vCount = 0;
  for (const doc of vehiclesSnap.docs) {
    const data = doc.data();
    if (data.currentKm != null && data.currentKm < 0) {
      console.log(`Fixing Vehicle ${doc.id} (${data.displayName || data.name}): currentKm=${data.currentKm}(->0)`);
      batch.update(doc.ref, { currentKm: 0 });
      vCount++;

      if (vCount % 400 === 0) {
         await batch.commit();
         batch = db.batch();
      }
    }
  }

  if (vCount > 0) {
     await batch.commit();
  }
  console.log(`Fixed ${vCount} vehicles.`);
}

run().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
