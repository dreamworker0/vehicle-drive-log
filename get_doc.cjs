const admin = require('firebase-admin');

admin.initializeApp({
  projectId: 'vehicle-drive-log'
});

const db = admin.firestore();

async function run() {
  try {
    const doc = await db.collection('vehicles').doc('mc6sSiseckIsArpAoFMO').get();
    if (doc.exists) {
      console.log(JSON.stringify(doc.data(), null, 2));
    } else {
      console.log('Document does not exist.');
    }
  } catch (e) {
    console.error(e);
  }
}

run();
