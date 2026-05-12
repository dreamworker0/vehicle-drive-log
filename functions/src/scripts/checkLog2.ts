import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST = '';
initializeApp();
const db = getFirestore();

async function run() {
  const snap = await db.collection('driveLogs')
    .orderBy('timestamp', 'desc')
    .limit(20)
    .get();
  
  snap.forEach(doc => {
    const data = doc.data();
    console.log(`[${data.driveDate} ${data.startTime}] ${data.driverName}: ${data.startKm} -> ${data.endKm} (dist: ${data.distance}) id: ${doc.id}`);
  });
}
run().then(() => process.exit(0)).catch(console.error);
