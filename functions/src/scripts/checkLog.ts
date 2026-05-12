import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST = '';
initializeApp();
const db = getFirestore();

async function run() {
  const snap = await db.collection('driveLogs')
    .where('vehicleName', '>=', '')
    .orderBy('vehicleName')
    .limit(10)
    .get();
  
  if (snap.empty) {
    console.log('No logs found');
    return;
  }
  
  snap.forEach(doc => {
    console.log(doc.data().vehicleName, doc.data().driveDate);
  });
}

run().then(() => process.exit(0)).catch(console.error);
