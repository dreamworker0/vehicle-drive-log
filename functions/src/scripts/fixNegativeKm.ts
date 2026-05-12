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
    if (data.startKm != null && data.endKm != null && data.distance != null) {
      if (data.endKm < data.startKm || data.endKm - data.startKm !== data.distance) {
         const correctEndKm = data.startKm + data.distance;
         console.log(`Fixing ${doc.id}: start=${data.startKm}, end=${data.endKm}(->${correctEndKm}), dist=${data.distance}`);
         batch.update(doc.ref, { endKm: correctEndKm });
         count++;
         
         if (count % 400 === 0) {
            await batch.commit();
            batch = db.batch();
         }
      }
    }
  }
  
  if (count > 0) {
     await batch.commit();
  }
  console.log(`Fixed ${count} logs.`);
}

run().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
