const admin = require('firebase-admin');
const { z } = require('zod');

admin.initializeApp({
  projectId: 'vehicle-drive-log'
});

const db = admin.firestore();

// Copy necessary schema parts for testing
const timestampSchema = z.custom((val) => val != null);

const vehicleRetiredSchema = z.object({
    isRetired: z.boolean(),
    reason: z.string(),
    retiredAt: timestampSchema,
});

const vehicleMaintenanceSchema = z.object({
    isBlocked: z.boolean(),
    reason: z.string(),
    endDate: z.string().nullable(),
    recordId: z.string(),
    blockedAt: timestampSchema,
});

const vehicleSchema = z.object({
    organizationId: z.string(),
    name: z.string(),
    displayName: z.string().optional(),
    modelName: z.string().optional(),
    plateNumber: z.string(),
    type: z.custom(),
    vehicleType: z.string().optional(),
    fuelType: z.custom().optional(),
    currentKm: z.number(),
    insurance: z.object({
        company: z.string(),
        phone: z.string(),
    }).optional(),
    hipassCardNumber: z.string().optional(),
    googleCalendarId: z.string().optional(),
    retired: vehicleRetiredSchema.nullable().optional(),
    maintenance: vehicleMaintenanceSchema.nullable().optional(),
    createdAt: timestampSchema.optional(),
});

async function run() {
  try {
    const doc = await db.collection('vehicles').doc('mc6sSiseckIsArpAoFMO').get();
    if (doc.exists) {
      const data = doc.data();
      const result = vehicleSchema.safeParse(data);
      if (!result.success) {
        console.error("Zod Parse Failed:", JSON.stringify(result.error.format(), null, 2));
      } else {
        console.log("Parse Success:", result.data);
      }
    } else {
      console.log('Document does not exist.');
    }
  } catch (e) {
    console.error("Error:", e);
  }
}

run();
