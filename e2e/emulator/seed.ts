/**
 * e2e/emulator/seed.ts — Firebase 에뮬레이터 시드.
 * admin SDK로 Auth 계정(+custom claims)과 Firestore 테스트 데이터를 주입한다.
 * admin SDK는 firebase emulators:exec가 주입하는 FIREBASE_AUTH_EMULATOR_HOST /
 * FIRESTORE_EMULATOR_HOST 환경변수를 감지해 자동으로 에뮬레이터를 대상으로 동작한다.
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
// 값을 복제하지 않고 원본을 가져온다 — 약관 개정으로 버전이 오르면 시드도 자동으로 따라가야
// 재동의 게이트가 E2E를 막지 않는다. (constants.ts는 import가 없는 순수 상수 모듈이라 Node에서 안전)
import { TERMS_VERSION, PRIVACY_VERSION } from '../../src/lib/constants';

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
    modelName: '쏘나타',
};

/**
 * 구글 캘린더가 연동된 차량. 캘린더 동기화 쿨다운/재시도 E2E 전용.
 * googleCalendarId에 '@'가 있어야 calendarLinkedVehicles 필터를 통과해
 * 동기화 컨트롤('지금 동기화')과 배경 자동 동기화가 활성화된다.
 */
export const TEST_CALENDAR_VEHICLE = {
    id: 'e2e-vehicle-cal',
    displayName: '카니발 88가8888',
    modelName: '카니발',
    googleCalendarId: 'e2e-cal@group.calendar.google.com',
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
    // consent는 재동의 게이트(useConsentGate)가 참조한다. 없으면 관리자에게 차단 모달이 떠
    // 클릭을 가로채므로 인증 E2E 전체가 실패한다. 게이트 자체를 검증하는 테스트가 아니라면
    // 시드 계정은 항상 현행 버전에 동의한 상태여야 한다.
    await db.collection('organizations').doc(TEST_ORG_ID).set({
        name: 'E2E 테스트 기관',
        status: 'approved',
        createdAt: now,
        consent: {
            terms: true,
            privacy: true,
            termsVersion: TERMS_VERSION,
            privacyVersion: PRIVACY_VERSION,
            agreedAt: now,
        },
    }, { merge: true });

    await db.collection('users').doc(TEST_ADMIN.uid).set({
        uid: TEST_ADMIN.uid, name: TEST_ADMIN.name, email: TEST_ADMIN.email,
        role: 'admin', organizationId: TEST_ORG_ID, organizationStatus: 'approved',
        status: 'active', createdAt: now,
        consent: { terms: true, termsVersion: TERMS_VERSION, agreedAt: now },
    }, { merge: true });

    await db.collection('users').doc(TEST_EMPLOYEE.uid).set({
        uid: TEST_EMPLOYEE.uid, name: TEST_EMPLOYEE.name, email: TEST_EMPLOYEE.email,
        role: 'employee', organizationId: TEST_ORG_ID, organizationStatus: 'approved',
        status: 'active', createdAt: now,
        consent: { terms: true, termsVersion: TERMS_VERSION, agreedAt: now },
    }, { merge: true });

    // merge를 쓰지 않는다 — 과거 실행에서 남은 필드가 파싱/테스트 결과에 영향을 주지 않도록
    // 매번 스키마에 맞는 완전한 문서로 덮어쓴다. modelName은 vehicleSchema 필수 필드다.
    await db.collection('vehicles').doc(TEST_VEHICLE.id).set({
        organizationId: TEST_ORG_ID,
        displayName: TEST_VEHICLE.displayName,
        name: TEST_VEHICLE.displayName,
        modelName: TEST_VEHICLE.modelName,
        currentKm: 50000,
        fuelType: 'gasoline',
        vehicleType: 'sedan',
        status: 'active',
        createdAt: now,
    });

    await seedHolidays(db);
}

/**
 * `system/holidays`를 시드한다. **예약 화면 E2E의 필수 시드다.**
 *
 * fetchPublicHolidays는 이 문서를 먼저 읽고, 없으면 공공데이터 포털
 * (apis.data.go.kr)로 폴백한다. 에뮬레이터 환경에는 VITE_HOLIDAY_API_KEY가 없고
 * 이 문서도 없었기 때문에, 예약 화면을 열면 매번 외부 실서비스로 나갔다.
 * useReservationData가 그 fetch를 Promise.all로 await하므로 응답이 늦으면
 * loading이 풀리지 않고 ReservationCalendar가 스피너에서 멈춘다 —
 * 승인/반려 목록이 아예 마운트되지 않아 CI에서 간헐 실패했다.
 *
 * 프로덕션은 monthlyBatch가 이 문서를 채우므로 Firestore 경로가 정상 경로다.
 * 시드로 그 상태를 재현해 E2E를 외부 네트워크와 무관하게 만든다.
 */
async function seedHolidays(db: ReturnType<typeof getFirestore>): Promise<void> {
    // 날짜가 고정된 공휴일만 쓴다 — 연도를 바꿔도 그대로 유효하다(설날·추석은 음력이라 제외).
    const fixed: [string, string][] = [
        ['01-01', '1월 1일'],
        ['03-01', '삼일절'],
        ['05-05', '어린이날'],
        ['06-06', '현충일'],
        ['08-15', '광복절'],
        ['10-03', '개천절'],
        ['10-09', '한글날'],
        ['12-25', '기독탄신일'],
    ];

    // getHolidays()는 브라우저 로컬 시각의 연도를 조회한다. 러너는 UTC, 앱 사용자는 KST라
    // 연말에 연도가 엇갈릴 수 있으므로 올해와 내년을 함께 심는다.
    const year = new Date().getFullYear();
    const byYear: Record<string, Record<string, string>> = {};
    for (const y of [year, year + 1]) {
        byYear[String(y)] = Object.fromEntries(fixed.map(([md, name]) => [`${y}-${md}`, name]));
    }

    await db.collection('system').doc('holidays').set(byYear, { merge: true });
}

/**
 * 구글 캘린더 연동 차량 1대를 시드한다. 캘린더 동기화 쿨다운 E2E 전용.
 * 기본 시드(seedEmulator)에는 넣지 않는다 — 다른 인증 스펙이 예약/대시보드
 * 화면에서 불필요한 배경 캘린더 동기화(functions 에뮬레이터 부재로 실패)를
 * 트리거하지 않도록, 이 차량은 해당 스펙의 beforeAll에서만 심고 afterAll에서 지운다.
 */
export async function seedCalendarLinkedVehicle(): Promise<void> {
    if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
    const db = getFirestore();
    await db.collection('vehicles').doc(TEST_CALENDAR_VEHICLE.id).set({
        organizationId: TEST_ORG_ID,
        displayName: TEST_CALENDAR_VEHICLE.displayName,
        name: TEST_CALENDAR_VEHICLE.displayName,
        modelName: TEST_CALENDAR_VEHICLE.modelName,
        googleCalendarId: TEST_CALENDAR_VEHICLE.googleCalendarId,
        currentKm: 30000,
        fuelType: 'gasoline',
        vehicleType: 'van',
        status: 'active',
        createdAt: new Date(),
    });
}

/** 캘린더 연동 차량 시드를 제거한다(스펙 afterAll에서 호출해 다른 스펙과 격리). */
export async function deleteCalendarLinkedVehicle(): Promise<void> {
    if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
    const db = getFirestore();
    await db.collection('vehicles').doc(TEST_CALENDAR_VEHICLE.id).delete();
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
