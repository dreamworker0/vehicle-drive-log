/**
 * e2e/emulator/seed.ts — Firebase 에뮬레이터 시드.
 * admin SDK로 Auth 계정(+custom claims)과 Firestore 테스트 데이터를 주입한다.
 * admin SDK는 firebase emulators:exec가 주입하는 FIREBASE_AUTH_EMULATOR_HOST /
 * FIRESTORE_EMULATOR_HOST 환경변수를 감지해 자동으로 에뮬레이터를 대상으로 동작한다.
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID =
    process.env.GCLOUD_PROJECT ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    'vehicle-drive-log';

export const TEST_ORG_ID = 'e2e-org';
export const TEST_ADMIN = {
    uid: 'e2e-admin',
    email: 'e2e-admin@test.local',
    password: 'test1234',
    name: 'E2E 관리자',
};
export const TEST_EMPLOYEE = {
    uid: 'e2e-employee',
    email: 'e2e-emp@test.local',
    password: 'test1234',
    name: 'E2E 직원',
};
export const TEST_VEHICLE = {
    id: 'e2e-vehicle',
    displayName: '쏘나타 99가9999',
};

export async function seedEmulator(): Promise<void> {
    if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
    const auth = getAuth();
    const db = getFirestore();

    // 1) Auth 계정 (이미 있으면 무시)
    for (const u of [TEST_ADMIN, TEST_EMPLOYEE]) {
        try {
            await auth.createUser({ uid: u.uid, email: u.email, password: u.password, displayName: u.name });
        } catch (e: unknown) {
            const code = (e as { code?: string })?.code;
            if (code !== 'auth/uid-already-exists' && code !== 'auth/email-already-exists') throw e;
        }
    }
    // Custom claims (firestore.rules가 token.role / token.orgId를 검증)
    await auth.setCustomUserClaims(TEST_ADMIN.uid, { role: 'admin', orgId: TEST_ORG_ID });
    await auth.setCustomUserClaims(TEST_EMPLOYEE.uid, { role: 'employee', orgId: TEST_ORG_ID });

    // 2) Firestore 시드
    const now = new Date();
    await db.collection('organizations').doc(TEST_ORG_ID).set({
        name: 'E2E 테스트 기관',
        status: 'approved',
        createdAt: now,
    }, { merge: true });

    await db.collection('users').doc(TEST_ADMIN.uid).set({
        uid: TEST_ADMIN.uid, name: TEST_ADMIN.name, email: TEST_ADMIN.email,
        role: 'admin', organizationId: TEST_ORG_ID, organizationStatus: 'approved',
        status: 'active', createdAt: now,
    }, { merge: true });

    await db.collection('users').doc(TEST_EMPLOYEE.uid).set({
        uid: TEST_EMPLOYEE.uid, name: TEST_EMPLOYEE.name, email: TEST_EMPLOYEE.email,
        role: 'employee', organizationId: TEST_ORG_ID, organizationStatus: 'approved',
        status: 'active', createdAt: now,
    }, { merge: true });

    await db.collection('vehicles').doc(TEST_VEHICLE.id).set({
        organizationId: TEST_ORG_ID,
        displayName: TEST_VEHICLE.displayName,
        name: TEST_VEHICLE.displayName,
        currentKm: 50000,
        fuelType: 'gasoline',
        vehicleType: 'sedan',
        status: 'active',
        createdAt: now,
    }, { merge: true });
}

/**
 * 승인 대기(pending) 예약 1건을 시드한다. 승인/반려 E2E 전용.
 * `set`(merge 없음)으로 덮어써 재시드 시 항상 pending으로 초기화된다(재시도 안전).
 * 예약 생성 UI는 createReservationSafe 콜러블 경유라 functions 에뮬레이터가 없는
 * E2E 환경에서는 UI로 만들 수 없으므로, admin SDK로 직접 심는다.
 */
export async function seedPendingReservation(
    id: string,
    overrides: Record<string, unknown> = {},
): Promise<void> {
    if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
    const db = getFirestore();
    await db.collection('reservations').doc(id).set({
        organizationId: TEST_ORG_ID,
        vehicleId: TEST_VEHICLE.id,
        vehicleName: TEST_VEHICLE.displayName,
        reservedByUid: TEST_EMPLOYEE.uid,
        reservedByName: TEST_EMPLOYEE.name,
        date: '2999-12-31',
        startTime: '09:00',
        endTime: '10:00',
        destination: '(seed)',
        purpose: '업무',
        status: 'pending',
        createdAt: new Date(),
        ...overrides,
    });
}

/**
 * 운행일지 1건을 시드한다. 내보내기(엑셀/PDF) E2E 전용.
 * `date`는 기간 필터·내보내기 범위 검증에 쓰이므로 overrides로 지정 가능.
 */
export async function seedDriveLog(
    id: string,
    overrides: Record<string, unknown> = {},
): Promise<void> {
    if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
    const db = getFirestore();
    await db.collection('driveLogs').doc(id).set({
        organizationId: TEST_ORG_ID,
        vehicleId: TEST_VEHICLE.id,
        vehicleName: TEST_VEHICLE.displayName,
        driverUid: TEST_EMPLOYEE.uid,
        driverName: TEST_EMPLOYEE.name,
        date: '2026-07-02',
        startTime: '09:00',
        endTime: '10:00',
        startKm: 50000,
        endKm: 50042,
        distance: 42,
        purpose: '업무',
        destination: '(seed)',
        timestamp: new Date('2026-07-02T09:00:00+09:00'),
        createdAt: new Date(),
        ...overrides,
    });
}
