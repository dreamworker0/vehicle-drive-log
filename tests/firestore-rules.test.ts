// @vitest-environment node
import { assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Firebase 에뮬레이터 프로젝트 ID
const PROJECT_ID = 'vehicle-drive-log-test';

let testEnv: RulesTestEnvironment;

describe('Firestore Security Rules for Multi-Tenant Isolation', () => {
  beforeAll(async () => {
    // 에뮬레이터 환경 초기화 (firestore.rules 읽어오기)
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
        host: '127.0.0.1',
        port: 8080,
      },
    });
  });

  beforeEach(async () => {
    // 각 테스트 단위마다 Firestore 초기화
    await testEnv.clearFirestore();
  });

  afterAll(async () => {
    // 모든 테스트가 끝나면 리소스 정리
    await testEnv.cleanup();
  });

  // Mock Contexts
  const setupContext = (uid: string, token: Record<string, unknown>) => testEnv.authenticatedContext(uid, token);
  const _unauthContext = () => testEnv.unauthenticatedContext();

  it('1. 타 조직 데이터 접근 공격 (Tenant Isolation)', async () => {
    // given: 조직 A의 자동차가 존재함 (관리자가 생성했다고 가정하는 편의를 위해 내부 어드민 룰을 통과하는 셋업)
    // withSecurityRulesDisabled를 사용하면 Rules를 우회하여 초기 데이터를 세팅할 수 있습니다.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('vehicles').doc('vehicle_B').set({
        organizationId: 'org-B',
        plateNumber: '11가1111',
      });
      await db.collection('driveLogs').doc('log_B').set({
        organizationId: 'org-B',
        vehicleId: 'vehicle_B',
        driverUid: 'user_B',
        purpose: '외근',
      });
    });

    // when & then: org-A 멤버가 org-B 데이터에 읽기/수정을 시도
    const orgAMemberDb = setupContext('user_A', { role: 'member', orgId: 'org-A' }).firestore();

    // org-B의 차량 조회
    const vehicleReadPromise = orgAMemberDb.collection('vehicles').doc('vehicle_B').get();
    await assertFails(vehicleReadPromise);

    // org-B의 운행일지 조회
    const logReadPromise = orgAMemberDb.collection('driveLogs').doc('log_B').get();
    await assertFails(logReadPromise);

    // org-B에 기습적으로 운행일지 기록
    const badLogWritePromise = orgAMemberDb.collection('driveLogs').doc('evil_log').set({
      organizationId: 'org-B',  // 내 orgId가 아님
      vehicleId: 'vehicle_B',
      driverUid: 'user_A',
      purpose: '타 조직으로 비용 떠넘기기',
    });
    await assertFails(badLogWritePromise);
  });

  it('2. 권한 상승 공격 (Privilege Escalation)', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('vehicles').doc('vehicle_A').set({
        organizationId: 'org-A',
        plateNumber: '22나2222',
        currentKm: 1000,
      });
    });

    const orgAMemberDb = setupContext('user_A', { role: 'member', orgId: 'org-A' }).firestore();

    // 일반 멤버가 차량 삭제 시도
    const vehicleDelPromise = orgAMemberDb.collection('vehicles').doc('vehicle_A').delete();
    await assertFails(vehicleDelPromise);

    // 일반 멤버가 자기 계정 role을 강제로 관리자로 변경 시도 (`users/{uid}` 수정 제약)
    const promotePromise = orgAMemberDb.collection('users').doc('user_A').update({
      role: 'admin',
    });
    await assertFails(promotePromise); // diff.affectedKeys().hasAny(['role', 'organizationId'])에 걸려야 함
  });

  it('3. 데이터 주입 공격 (driverUid 속이기 및 주행거리 역행)', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('vehicles').doc('vehicle_A').set({
        organizationId: 'org-A',
        plateNumber: '22나2222',
        currentKm: 5000,
      });
    });

    const orgAMemberDb = setupContext('user_A', { role: 'member', orgId: 'org-A' }).firestore();

    // 작성자(createdByUid)를 타인으로 위조해 운행일지 생성 시도 → 차단
    // (driverUid는 대표 운전자로 타인 지정이 허용되지만, 작성자 위조는 금지)
    const spoofedLogWrite = orgAMemberDb.collection('driveLogs').doc('log_spoof').set({
      organizationId: 'org-A',
      vehicleId: 'vehicle_A',
      driverUid: 'user_A',
      createdByUid: 'user_B_boss', // 작성자 위조
      purpose: '몰래 쓴 내역',
    });
    await assertFails(spoofedLogWrite);

    // 차량의 주행거리를 이전으로 돌려버림 (조작)
    const rewindKm = orgAMemberDb.collection('vehicles').doc('vehicle_A').update({
      currentKm: 3000, // 기존 5000에서 감소
    });
    await assertFails(rewindKm);
    
    // 허용되는 정상 업데이트(주행거리 증가)는 성공해야 정상
    const forwardKm = orgAMemberDb.collection('vehicles').doc('vehicle_A').update({
      currentKm: 5100, // 증가
    });
    await assertSucceeds(forwardKm);
  });
  
  it('4. 관리자의 정상 오퍼레이션 허용', async () => {
    const orgAAdminDb = setupContext('admin_A', { role: 'admin', orgId: 'org-A' }).firestore();

    // 새 차량 등록 성공 여부
    const newVehicle = orgAAdminDb.collection('vehicles').doc('vehicle_new').set({
      organizationId: 'org-A',
      plateNumber: '111가1111',
      currentKm: 0
    });
    await assertSucceeds(newVehicle);
  });

  it('5. 예약(reservations) 조직 격리 및 명의 위조 차단', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().collection('reservations').doc('res_B').set({
        organizationId: 'org-B',
        vehicleId: 'vehicle_B',
        reservedByUid: 'user_B',
      });
    });

    const orgAMemberDb = setupContext('user_A', { role: 'member', orgId: 'org-A' }).firestore();

    // 타 조직 예약 조회 차단
    await assertFails(orgAMemberDb.collection('reservations').doc('res_B').get());

    // 타 조직으로 예약 생성 차단
    await assertFails(orgAMemberDb.collection('reservations').doc('res_evil').set({
      organizationId: 'org-B',
      vehicleId: 'vehicle_B',
      reservedByUid: 'user_A',
    }));

    // 타인 명의(reservedByUid 위조) 예약 생성 차단
    await assertFails(orgAMemberDb.collection('reservations').doc('res_spoof').set({
      organizationId: 'org-A',
      vehicleId: 'vehicle_A',
      reservedByUid: 'user_B',
    }));

    // 예약 생성은 createReservationSafe(콜러블) 전용 — 클라이언트 직접 생성은 본인 조직·본인
    // 명의여도 차단(allowedUserIds·중복·승인 검증 우회 방지, 2026-07-10 감사 #5)
    await assertFails(orgAMemberDb.collection('reservations').doc('res_ok').set({
      organizationId: 'org-A',
      vehicleId: 'vehicle_A',
      reservedByUid: 'user_A',
    }));
  });

  it('5-1. 예약 소유자의 pending→reserved 자가 승인 차단, 취소/완료는 허용', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('reservations').doc('res_pending').set({
        organizationId: 'org-A', vehicleId: 'vehicle_A', reservedByUid: 'user_A', status: 'pending',
      });
      await db.collection('reservations').doc('res_reserved').set({
        organizationId: 'org-A', vehicleId: 'vehicle_A', reservedByUid: 'user_A', status: 'reserved',
      });
    });

    const orgAMemberDb = setupContext('user_A', { role: 'employee', orgId: 'org-A' }).firestore();

    // 소유자가 승인 대기(pending)를 스스로 확정(reserved)으로 바꾸는 자가 승인 → 차단
    await assertFails(orgAMemberDb.collection('reservations').doc('res_pending').update({ status: 'reserved' }));

    // 소유자가 자기 예약을 취소하는 것은 허용
    await assertSucceeds(orgAMemberDb.collection('reservations').doc('res_pending').update({ status: 'cancelled' }));

    // 소유자가 운행 종료(reserved→completed)하는 것은 허용
    await assertSucceeds(orgAMemberDb.collection('reservations').doc('res_reserved').update({ status: 'completed' }));

    // admin은 승인(pending→reserved) 허용
    const adminADb = setupContext('admin_A', { role: 'admin', orgId: 'org-A' }).firestore();
    await assertSucceeds(adminADb.collection('reservations').doc('res_reserved').update({ status: 'reserved', reservedByName: 'x' }));
  });

  it('5-2. 예약 삭제 — 소유자 본인과 기관 관리자만 허용, 타 기관·타인(직원)은 차단', async () => {
    // 다일·반복 그룹 수정은 "기존 그룹 삭제 → 재생성" 경로라 삭제 권한이 필요한데
    // superAdmin 전용이던 탓에 소유자 본인조차 그룹 수정이 항상 실패했다.
    //
    // 기관 관리자를 한동안 제외했던 이유는 명의 이전이었다(createReservationSafe가
    // reservedByUid를 호출자로 강제했다). 서버가 reservedByUid를 받아 명의를 보존하도록
    // 고친 뒤 관리자 경로를 열었다 — 관리자는 이미 같은 기관 예약을 update로 고칠 수 있어,
    // 그룹 수정만 막히는 것은 경계가 아니라 반쪽짜리 제약이었다.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const base = { vehicleId: 'vehicle_A', status: 'reserved', groupId: 'grp_1', date: '2026-08-01' };
      await db.collection('reservations').doc('res_own').set({ ...base, organizationId: 'org-A', reservedByUid: 'user_A' });
      await db.collection('reservations').doc('res_admin').set({ ...base, organizationId: 'org-A', reservedByUid: 'user_A' });
      await db.collection('reservations').doc('res_other').set({ ...base, organizationId: 'org-A', reservedByUid: 'user_other' });
      await db.collection('reservations').doc('res_orgB').set({ ...base, organizationId: 'org-B', reservedByUid: 'user_B' });
    });

    const ownerDb = setupContext('user_A', { role: 'employee', orgId: 'org-A' }).firestore();
    const adminDb = setupContext('admin_A', { role: 'admin', orgId: 'org-A' }).firestore();
    const otherOrgAdminDb = setupContext('admin_B', { role: 'admin', orgId: 'org-B' }).firestore();

    // 직원이 같은 기관 타인 명의 예약을 삭제 → 차단 (관리자만 열렸다)
    await assertFails(ownerDb.collection('reservations').doc('res_other').delete());
    // 타 기관 예약 삭제 → 차단 (관리자여도)
    await assertFails(adminDb.collection('reservations').doc('res_orgB').delete());
    await assertFails(otherOrgAdminDb.collection('reservations').doc('res_other').delete());

    // 소유자 본인 예약 삭제 → 허용
    await assertSucceeds(ownerDb.collection('reservations').doc('res_own').delete());
    // 기관 관리자의 소속 기관 직원 예약 삭제 → 허용 (그룹 수정 경로)
    await assertSucceeds(adminDb.collection('reservations').doc('res_admin').delete());
  });

  it('6. 비용 데이터(주유·하이패스·정비) 교차 조직 접근 차단', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('fuelLogs').doc('fuel_B').set({
        organizationId: 'org-B', vehicleId: 'vehicle_B', driverUid: 'user_B', cost: 50000,
      });
      await db.collection('hipassCharges').doc('hp_B').set({
        organizationId: 'org-B', cardId: 'card_B', chargerUid: 'user_B', amount: 30000,
      });
      await db.collection('maintenanceRecords').doc('mt_B').set({
        organizationId: 'org-B', vehicleId: 'vehicle_B', description: '엔진오일 교체',
      });
      await db.collection('fuelLogs').doc('fuel_A').set({
        organizationId: 'org-A', vehicleId: 'vehicle_A', driverUid: 'user_A', cost: 40000,
      });
    });

    const orgAMemberDb = setupContext('user_A', { role: 'member', orgId: 'org-A' }).firestore();

    // 타 조직 비용 데이터 조회는 전부 차단
    await assertFails(orgAMemberDb.collection('fuelLogs').doc('fuel_B').get());
    await assertFails(orgAMemberDb.collection('hipassCharges').doc('hp_B').get());
    await assertFails(orgAMemberDb.collection('maintenanceRecords').doc('mt_B').get());

    // 본인 조직 데이터는 정상 조회
    await assertSucceeds(orgAMemberDb.collection('fuelLogs').doc('fuel_A').get());
  });

  it('7. 알림(notifications) 생성은 superAdmin 전용, 조회는 본인 대상만', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().collection('notifications').doc('noti_A').set({
        targetUid: 'user_A', organizationId: 'org-A', type: 'approval', message: '승인 알림',
      });
    });

    const orgAMemberDb = setupContext('user_A', { role: 'member', orgId: 'org-A' }).firestore();

    // 일반 사용자는 같은 조직 UID 대상이라도 알림 생성 불가 (superAdmin 전용 — 알림 주입 차단)
    await assertFails(orgAMemberDb.collection('notifications').doc('noti_evil').set({
      targetUid: 'user_A2', organizationId: 'org-A', message: '피싱 텍스트 주입 시도',
    }));

    // superAdmin은 생성 가능 (승인/반려 알림 화면)
    const superDb = setupContext('super_1', { role: 'superAdmin' }).firestore();
    await assertSucceeds(superDb.collection('notifications').doc('noti_ok').set({
      targetUid: 'user_A', organizationId: 'org-A', message: '기관 승인 완료',
    }));

    // 본인 대상 알림은 조회 가능, 타인 알림은 차단
    await assertSucceeds(orgAMemberDb.collection('notifications').doc('noti_A').get());
    const orgBMemberDb = setupContext('user_B', { role: 'member', orgId: 'org-B' }).firestore();
    await assertFails(orgBMemberDb.collection('notifications').doc('noti_A').get());
  });

  it('8. 관리자의 organizationId 변경(교차 테넌트 권한상승) 차단', async () => {
    // given: 기관 A의 admin과 소속 직원 문서 존재
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('users').doc('admin_A').set({
        email: 'admin_a@x.com', role: 'admin', organizationId: 'org-A',
      });
      await db.collection('users').doc('user_A2').set({
        email: 'user_a2@x.com', role: 'employee', organizationId: 'org-A',
      });
    });

    const adminADb = setupContext('admin_A', { role: 'admin', orgId: 'org-A' }).firestore();

    // admin이 자기 문서의 org를 타 기관으로 변경(자기 권한상승) → 차단
    await assertFails(adminADb.collection('users').doc('admin_A').update({
      organizationId: 'org-B',
    }));

    // admin이 소속 직원을 타 기관으로 이동 → 차단
    await assertFails(adminADb.collection('users').doc('user_A2').update({
      organizationId: 'org-B',
    }));

    // 정상: admin이 소속 직원 role을 변경(org 불변)하는 것은 허용
    await assertSucceeds(adminADb.collection('users').doc('user_A2').update({
      role: 'admin',
    }));
  });

  it('9. admin의 organizationId 변경 차단 — 차량·운행일지·예약·주유·정비 전 컬렉션', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('vehicles').doc('v_A').set({ organizationId: 'org-A', plateNumber: '1', currentKm: 10 });
      await db.collection('driveLogs').doc('dl_A').set({ organizationId: 'org-A', vehicleId: 'v_A', driverUid: 'user_A', startKm: 10, endKm: 20 });
      await db.collection('reservations').doc('r_A').set({ organizationId: 'org-A', vehicleId: 'v_A', reservedByUid: 'user_A', status: 'reserved' });
      await db.collection('fuelLogs').doc('f_A').set({ organizationId: 'org-A', vehicleId: 'v_A', driverUid: 'user_A', cost: 100 });
      await db.collection('maintenanceRecords').doc('m_A').set({ organizationId: 'org-A', vehicleId: 'v_A', description: 'x' });
    });

    const adminADb = setupContext('admin_A', { role: 'admin', orgId: 'org-A' }).firestore();

    // 모든 테넌트 문서에서 admin의 org 이전 시도 → 차단
    await assertFails(adminADb.collection('vehicles').doc('v_A').update({ organizationId: 'org-B' }));
    await assertFails(adminADb.collection('driveLogs').doc('dl_A').update({ organizationId: 'org-B' }));
    await assertFails(adminADb.collection('reservations').doc('r_A').update({ organizationId: 'org-B' }));
    await assertFails(adminADb.collection('fuelLogs').doc('f_A').update({ organizationId: 'org-B' }));
    await assertFails(adminADb.collection('maintenanceRecords').doc('m_A').update({ organizationId: 'org-B' }));

    // 정상: org를 유지한 채 다른 필드 수정은 허용
    await assertSucceeds(adminADb.collection('maintenanceRecords').doc('m_A').update({ description: 'y' }));
  });

  it('10. 기관(organizations) 클라이언트 직접 생성 차단 (승인 절차 우회 방지)', async () => {
    // 일반 로그인 사용자가 status:approved·inviteCode를 임의 지정해 승인된 기관을 생성 시도 → 차단
    const memberDb = setupContext('user_X', { role: 'employee' }).firestore();
    await assertFails(memberDb.collection('organizations').doc('org_evil').set({
      name: '가짜기관', applicantUid: 'user_X', status: 'approved', inviteCode: 'ABC123',
    }));

    // superAdmin은 생성 가능
    const superDb = setupContext('super_1', { role: 'superAdmin' }).firestore();
    await assertSucceeds(superDb.collection('organizations').doc('org_ok').set({
      name: '정상기관', applicantUid: 'super_1', status: 'pending',
    }));
  });

  it('10-1. 기관 동의 기록(consent) 클라이언트 변경 차단 — 위탁 계약 입증 자료 보호', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().collection('organizations').doc('org-A').set({
        name: '기관A', applicantUid: 'admin_A', status: 'approved',
        consent: { terms: true, privacy: true, termsVersion: '2026-08-05', privacyVersion: '2026-08-05' },
      });
      // 동의 기록이 없는 레거시 기관 — 클라이언트가 뒤늦게 심는 것도 막아야 한다
      await context.firestore().collection('organizations').doc('org-legacy').set({
        name: '레거시기관', applicantUid: 'admin_L', status: 'approved',
      });
    });

    const adminADb = setupContext('admin_A', { role: 'admin', orgId: 'org-A' }).firestore();
    const superDb = setupContext('super_1', { role: 'superAdmin' }).firestore();
    const adminLDb = setupContext('admin_L', { role: 'admin', orgId: 'org-legacy' }).firestore();

    // 기관 관리자·superAdmin 모두 동의 기록 변경·삭제 차단
    await assertFails(adminADb.collection('organizations').doc('org-A').update({
      consent: { terms: true, privacy: true, termsVersion: '2099-01-01', privacyVersion: '2099-01-01' },
    }));
    await assertFails(superDb.collection('organizations').doc('org-A').update({
      consent: { terms: false, privacy: false, termsVersion: 'x', privacyVersion: 'x' },
    }));

    // 레거시 기관에 동의 기록을 클라이언트가 신설하는 것도 차단 (서버 경로만 허용)
    await assertFails(adminLDb.collection('organizations').doc('org-legacy').update({
      consent: { terms: true, privacy: true, termsVersion: '2026-08-05', privacyVersion: '2026-08-05' },
    }));

    // 정상: 동의 기록을 건드리지 않는 다른 필드 수정은 허용
    await assertSucceeds(adminADb.collection('organizations').doc('org-A').update({ hipassEnabled: false }));

    // 신청자 경로(status:'pending' + 본인 신청)도 consent를 건드리지 않으면 정상 동작해야 한다
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().collection('organizations').doc('org-pending').set({
        name: '신청중기관', applicantUid: 'applicant_1', status: 'pending',
      });
    });
    const applicantDb = setupContext('applicant_1', { role: 'employee' }).firestore();
    await assertSucceeds(applicantDb.collection('organizations').doc('org-pending').update({ address: '서울시' }));
    await assertFails(applicantDb.collection('organizations').doc('org-pending').update({
      consent: { terms: true, privacy: true, termsVersion: '2026-08-05', privacyVersion: '2026-08-05' },
    }));

    // create 경로로 임의 동의 기록을 심는 것도 차단 (update만 막으면 우회 가능)
    await assertFails(superDb.collection('organizations').doc('org_new_evil').set({
      name: '위조기관', applicantUid: 'super_1', status: 'pending',
      consent: { terms: true, privacy: true, termsVersion: '2026-08-05', privacyVersion: '2026-08-05' },
    }));
    // consent 없는 정상 create는 계속 허용
    await assertSucceeds(superDb.collection('organizations').doc('org_new_ok').set({
      name: '정상기관', applicantUid: 'super_1', status: 'pending',
    }));
  });

  it('10-2. 직원 이용약관 동의 기록(users.consent) 클라이언트 변경·주입 차단', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('users').doc('user_A').set({
        email: 'a@example.com', name: '직원A', role: 'employee', organizationId: 'org-A',
        consent: { terms: true, termsVersion: '2026-08-05' },
      });
      // 동의 기록이 없는 레거시 직원
      await db.collection('users').doc('user_L').set({
        email: 'l@example.com', name: '직원L', role: 'employee', organizationId: 'org-A',
      });
    });

    const ownerDb = setupContext('user_A', { role: 'employee', orgId: 'org-A' }).firestore();
    const adminDb = setupContext('admin_A', { role: 'admin', orgId: 'org-A' }).firestore();
    const superDb = setupContext('super_1', { role: 'superAdmin' }).firestore();
    const legacyOwnerDb = setupContext('user_L', { role: 'employee', orgId: 'org-A' }).firestore();

    // 본인·기관관리자·superAdmin 모두 동의 기록 변경 차단
    await assertFails(ownerDb.collection('users').doc('user_A').update({
      consent: { terms: true, termsVersion: '2099-01-01' },
    }));
    await assertFails(adminDb.collection('users').doc('user_A').update({
      consent: { terms: false, termsVersion: 'x' },
    }));
    await assertFails(superDb.collection('users').doc('user_A').update({
      consent: { terms: false, termsVersion: 'x' },
    }));

    // 동의하지 않은 레거시 직원이 스스로 동의 기록을 심는 것도 차단
    await assertFails(legacyOwnerDb.collection('users').doc('user_L').update({
      consent: { terms: true, termsVersion: '2026-08-05' },
    }));

    // 정상: 동의 기록을 건드리지 않는 본인 프로필 수정은 허용
    await assertSucceeds(ownerDb.collection('users').doc('user_A').update({ phone: '010-1111-2222' }));

    // 신규 가입 시 클라이언트 create로 동의 기록을 심는 것도 차단
    const newUserDb = setupContext('user_new', { firebase: { sign_in_provider: 'google.com' } }).firestore();
    await assertFails(newUserDb.collection('users').doc('user_new').set({
      email: 'new@example.com', consent: { terms: true, termsVersion: '2026-08-05' },
    }));
    await assertSucceeds(newUserDb.collection('users').doc('user_new').set({ email: 'new@example.com' }));
  });

  it('10-3. 접속기록(auditLogs) — 클라이언트 쓰기 전면 차단, 읽기는 점검 주체만', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().collection('auditLogs').doc('log_A').set({
        organizationId: 'org-A', action: 'update', targetType: 'driveLog',
        targetId: 'dl_A', actorUid: null, actorSource: 'unknown', subjectUids: ['user_A'],
      });
    });

    const adminADb = setupContext('admin_A', { role: 'admin', orgId: 'org-A' }).firestore();
    const employeeADb = setupContext('user_A', { role: 'employee', orgId: 'org-A' }).firestore();
    const adminBDb = setupContext('admin_B', { role: 'admin', orgId: 'org-B' }).firestore();
    const superDb = setupContext('super_1', { role: 'superAdmin' }).firestore();

    // 쓰기: 누구도 불가 (Admin SDK 트리거 전용)
    await assertFails(adminADb.collection('auditLogs').doc('log_new').set({
      organizationId: 'org-A', action: 'create', targetType: 'driveLog', targetId: 'x',
    }));
    await assertFails(superDb.collection('auditLogs').doc('log_new2').set({
      organizationId: 'org-A', action: 'create', targetType: 'driveLog', targetId: 'x',
    }));
    // 기록 인멸 차단 — 수정·삭제 모두 불가
    await assertFails(adminADb.collection('auditLogs').doc('log_A').update({ action: 'create' }));
    await assertFails(superDb.collection('auditLogs').doc('log_A').update({ action: 'create' }));
    await assertFails(adminADb.collection('auditLogs').doc('log_A').delete());
    await assertFails(superDb.collection('auditLogs').doc('log_A').delete());

    // 읽기: 해당 기관 관리자와 superAdmin만
    await assertSucceeds(adminADb.collection('auditLogs').doc('log_A').get());
    await assertSucceeds(superDb.collection('auditLogs').doc('log_A').get());
    // 일반 직원은 자기 기관 기록도 볼 수 없다 (점검 주체가 아니다)
    await assertFails(employeeADb.collection('auditLogs').doc('log_A').get());
    // 타 기관 관리자는 차단 (멀티테넌트 격리)
    await assertFails(adminBDb.collection('auditLogs').doc('log_A').get());

    // 기관 미소속 계정(superAdmin)의 기록은 __system__으로 남는다 — superAdmin만 읽는다.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().collection('auditLogs').doc('log_sys').set({
        organizationId: '__system__', action: 'update', targetType: 'user',
        targetId: 'super_1', actorUid: null, actorSource: 'unknown', subjectUids: ['super_1'],
        changedFields: ['role'],
      });
    });
    await assertSucceeds(superDb.collection('auditLogs').doc('log_sys').get());
    await assertFails(adminADb.collection('auditLogs').doc('log_sys').get());
    await assertFails(adminBDb.collection('auditLogs').doc('log_sys').get());
  });


  it('10-3b. 접속기록 목록 조회 — 기관 필터가 있어야 통과한다 (점검 화면의 전제)', async () => {
    // 문서 단건 get이 통과하는 것과 목록 조회(list)가 통과하는 것은 별개다.
    // 점검 화면(getAuditLogs)은 list로 읽으므로, 기관 필터가 빠진 쿼리가 통째로
    // 거부되는 것을 여기서 고정한다 — 필터를 지우면 화면이 조용히 비는 대신 이 테스트가 깨진다.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('auditLogs').doc('log_A1').set({
        organizationId: 'org-A', action: 'login', targetType: 'session',
        targetId: 'user_A', actorUid: 'user_A', actorSource: 'auth', subjectUids: ['user_A'],
        at: new Date('2026-08-01T09:00:00Z'),
      });
      await db.collection('auditLogs').doc('log_B1').set({
        organizationId: 'org-B', action: 'login', targetType: 'session',
        targetId: 'user_B', actorUid: 'user_B', actorSource: 'auth', subjectUids: ['user_B'],
        at: new Date('2026-08-01T09:00:00Z'),
      });
    });

    const adminADb = setupContext('admin_A', { role: 'admin', orgId: 'org-A' }).firestore();
    const employeeADb = setupContext('user_A', { role: 'employee', orgId: 'org-A' }).firestore();

    // 자기 기관 필터 + 최신순 — 화면이 실제로 쓰는 쿼리 형태
    await assertSucceeds(
      adminADb.collection('auditLogs').where('organizationId', '==', 'org-A').orderBy('at', 'desc').limit(50).get()
    );
    // 유형 필터(action in) 조합도 같은 경계로 통과한다
    await assertSucceeds(
      adminADb.collection('auditLogs')
        .where('organizationId', '==', 'org-A')
        .where('action', 'in', ['create', 'update', 'delete'])
        .orderBy('at', 'desc').limit(50).get()
    );
    // 기관 필터가 없으면 타 기관 문서가 섞이므로 쿼리 전체가 거부된다
    await assertFails(adminADb.collection('auditLogs').orderBy('at', 'desc').limit(50).get());
    // 타 기관을 지목한 조회도 거부
    await assertFails(adminADb.collection('auditLogs').where('organizationId', '==', 'org-B').get());
    // 직원은 점검 주체가 아니라 자기 기관 목록도 못 읽는다
    await assertFails(employeeADb.collection('auditLogs').where('organizationId', '==', 'org-A').get());
  });


  it('10-4. 행위자 스탬프(lastEditedByUid) — 타인 명의 위조 차단, 생략은 허용', async () => {
    // 접속기록의 '계정' 항목(고시 제16조). 클라이언트가 심되 Rules가 인증 토큰과의
    // 일치를 강제하므로 타인 명의로는 심을 수 없다.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('vehicles').doc('v_A').set({ organizationId: 'org-A', plateNumber: '1', currentKm: 10 });
      await db.collection('driveLogs').doc('log_A').set({
        organizationId: 'org-A', vehicleId: 'v_A', driverUid: 'user_A', createdByUid: 'user_A', startKm: 0, endKm: 10,
      });
      await db.collection('users').doc('user_A').set({ organizationId: 'org-A', name: '직원A', email: 'a@t.kr', role: 'employee' });
      await db.collection('users').doc('user_T').set({ organizationId: 'org-A', name: '직원T', email: 't@t.kr', role: 'employee' });
    });

    const memberA = setupContext('user_A', { role: 'member', orgId: 'org-A' }).firestore();
    const adminA = setupContext('admin_A', { role: 'admin', orgId: 'org-A' }).firestore();

    // (1) 본인 uid로 스탬프 → 허용
    await assertSucceeds(memberA.collection('driveLogs').doc('log_A').update({
      destination: '용산구청', lastEditedByUid: 'user_A',
    }));

    // (2) 타인 uid로 스탬프 위조 → 차단. 이 한 줄이 스탬프를 신뢰할 수 있게 만든다.
    await assertFails(memberA.collection('driveLogs').doc('log_A').update({
      destination: '남산', lastEditedByUid: 'user_X',
    }));

    // (3) 스탬프 생략 → 허용. 모든 update에 요구하면 스탬프를 심지 않는 경로가
    //     통째로 permission-denied가 된다(Phase 129의 함정). 누락은 감사 로그에
    //     actorSource:'unknown'으로 드러나므로 조용히 묻히지 않는다.
    await assertSucceeds(memberA.collection('driveLogs').doc('log_A').update({ destination: '이태원' }));

    // (4) users 문서도 같은 규칙 — 관리자가 타인 권한을 바꿀 때 본인 명의로만 스탬프 가능
    await assertSucceeds(adminA.collection('users').doc('user_T').update({
      role: 'admin', lastEditedByUid: 'admin_A',
    }));

    // (5) 관리자가 피해자 명의로 스탬프를 심어 책임을 떠넘기는 시도 → 차단
    await assertFails(adminA.collection('users').doc('user_T').update({
      role: 'employee', lastEditedByUid: 'user_T',
    }));
  });


  it('10-5. 전체 공지 이력(broadcasts) — 클라이언트 쓰기 전면 차단, 읽기는 운영자만', async () => {
    // sendBroadcastNotice(Admin SDK)만 기록한다. 발송자 uid가 담기므로 읽기도 운영자 한정.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().collection('broadcasts').doc('bc_1').set({
        title: '약관 개정 안내', message: '8월 10일 시행', actorUid: 'sa_1',
        recipientCount: 812, status: 'sent',
      });
    });

    const superAdmin = setupContext('sa_1', { role: 'superAdmin' }).firestore();
    const adminA = setupContext('admin_A', { role: 'admin', orgId: 'org-A' }).firestore();
    const memberA = setupContext('user_A', { role: 'member', orgId: 'org-A' }).firestore();

    // (1) 운영자만 읽는다
    await assertSucceeds(superAdmin.collection('broadcasts').doc('bc_1').get());
    await assertFails(adminA.collection('broadcasts').doc('bc_1').get());
    await assertFails(memberA.collection('broadcasts').doc('bc_1').get());

    // (2) 운영자조차 쓸 수 없다 — 발송하지 않은 이력을 만들거나 지울 수 없어야 한다
    await assertFails(superAdmin.collection('broadcasts').doc('bc_2').set({ title: '위조' }));
    await assertFails(superAdmin.collection('broadcasts').doc('bc_1').update({ recipientCount: 0 }));
    await assertFails(superAdmin.collection('broadcasts').doc('bc_1').delete());
  });

  it('11. 비밀 사용자 데이터(users/{uid}/private) — 본인·같은 기관 모두 접근 차단 (Functions 전용)', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('users/user_A/private/oauth').set({
        accessToken: 'a', refreshToken: 'r', expiryDate: 1,
      });
    });

    // 본인조차 클라이언트에서 토큰을 읽거나 쓸 수 없다 (Admin SDK 전용)
    const ownerDb = setupContext('user_A', { role: 'employee', orgId: 'org-A' }).firestore();
    await assertFails(ownerDb.doc('users/user_A/private/oauth').get());
    await assertFails(ownerDb.doc('users/user_A/private/oauth').set({ accessToken: 'z' }));

    // 같은 기관 타 멤버도 당연히 차단
    const mateDb = setupContext('user_A2', { role: 'employee', orgId: 'org-A' }).firestore();
    await assertFails(mateDb.doc('users/user_A/private/oauth').get());
  });

  it('11-1. 기관 미소속(orgId null) 사용자 간 PII 상호 열람 차단 — "null == null" 우회 방지', async () => {
    // 탈퇴·기관 이동 대기 계정은 organizationId가 null로 명시 저장되고
    // 클레임의 orgId도 null이 된다(setCustomClaims). "같은 기관 멤버" 조건이
    // null == null로 성립해 미소속 계정끼리 이메일·이름·연락처를 읽을 수 있었다.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('users').doc('orphan_A').set({
        organizationId: null, name: '미소속A', email: 'a@t.kr', role: 'employee',
      });
      await db.collection('users').doc('orphan_B').set({
        organizationId: null, name: '미소속B', email: 'b@t.kr', role: 'employee',
      });
      await db.collection('users').doc('user_C').set({
        organizationId: 'org-C', name: '직원C', email: 'c@t.kr', role: 'employee',
      });
    });

    const orphanADb = setupContext('orphan_A', { role: 'employee', orgId: null }).firestore();

    // (1) 미소속끼리 상호 열람 차단
    await assertFails(orphanADb.collection('users').doc('orphan_B').get());

    // (2) 미소속 → 기관 소속 사용자 열람도 차단
    await assertFails(orphanADb.collection('users').doc('user_C').get());

    // (3) 본인 문서는 계속 읽을 수 있다 (회귀 가드 — 재가입 화면의 전제)
    await assertSucceeds(orphanADb.collection('users').doc('orphan_A').get());

    // (4) 기관 소속 멤버 간 열람은 계속 허용된다 (회귀 가드 — 정당한 접근 경로 보존)
    const memberCDb = setupContext('user_C2', { role: 'employee', orgId: 'org-C' }).firestore();
    await assertSucceeds(memberCDb.collection('users').doc('user_C').get());
  });

  it('12. 직원의 정비 기록 작성 — 본인 것만 허용, 차량 차단(blockVehicle)은 금지', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      // 관리자가 만든 기록 (작성자 없음)
      await db.collection('maintenanceRecords').doc('m_admin').set({
        organizationId: 'org-A', vehicleId: 'v_A', type: 'oil', blockVehicle: false,
      });
      // 다른 직원이 만든 기록
      await db.collection('maintenanceRecords').doc('m_other').set({
        organizationId: 'org-A', vehicleId: 'v_A', type: 'repair', blockVehicle: false, createdByUid: 'emp_2',
      });
      // 본인이 만든 기록
      await db.collection('maintenanceRecords').doc('m_mine').set({
        organizationId: 'org-A', vehicleId: 'v_A', type: 'repair', blockVehicle: false, createdByUid: 'emp_1',
      });
    });

    const empDb = setupContext('emp_1', { role: 'employee', orgId: 'org-A' }).firestore();

    // 본인 작성 정비 기록 생성 (blockVehicle:false) → 허용
    await assertSucceeds(empDb.collection('maintenanceRecords').doc('m_new').set({
      organizationId: 'org-A', vehicleId: 'v_A', type: 'repair', description: '범퍼 수리',
      createdByUid: 'emp_1', blockVehicle: false,
    }));

    // 차량 차단을 켜서 생성 시도 → 차단 (예약 취소 권한 우회 방지)
    await assertFails(empDb.collection('maintenanceRecords').doc('m_block').set({
      organizationId: 'org-A', vehicleId: 'v_A', type: 'repair',
      createdByUid: 'emp_1', blockVehicle: true,
    }));

    // 작성자를 타인으로 위조해 생성 시도 → 차단
    await assertFails(empDb.collection('maintenanceRecords').doc('m_forge').set({
      organizationId: 'org-A', vehicleId: 'v_A', type: 'repair',
      createdByUid: 'emp_2', blockVehicle: false,
    }));

    // 본인 기록 수정 → 허용
    await assertSucceeds(empDb.collection('maintenanceRecords').doc('m_mine').update({ description: '수정' }));

    // 본인 기록이라도 차량 차단으로 전환하는 수정 → 차단
    await assertFails(empDb.collection('maintenanceRecords').doc('m_mine').update({ blockVehicle: true }));

    // 타인·관리자 작성 기록 수정·삭제 → 차단
    await assertFails(empDb.collection('maintenanceRecords').doc('m_other').update({ description: '침범' }));
    await assertFails(empDb.collection('maintenanceRecords').doc('m_other').delete());
    await assertFails(empDb.collection('maintenanceRecords').doc('m_admin').update({ description: '침범' }));
    await assertFails(empDb.collection('maintenanceRecords').doc('m_admin').delete());

    // 본인 기록 삭제 → 허용 (마지막에 수행)
    await assertSucceeds(empDb.collection('maintenanceRecords').doc('m_mine').delete());
  });

  it('12-1. 금액·거리 필드의 음수 저장 차단 — 주유·충전·정비 기록', async () => {
    // 화면(각 훅의 validateNonNegativeFields)이 먼저 막지만, 클라이언트를 우회한
    // '불가능한 값'을 서버에서도 끊는다. driveLogs의 startKm >= 0과 같은 목적.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('hipassCards').doc('c_A').set({ organizationId: 'org-A', cardNumber: '1', balance: 10000 });
      // 이미 음수가 박힌 옛 기록 — 다른 필드 수정 길이 막히지 않아야 한다
      await db.collection('maintenanceRecords').doc('m_legacy').set({
        organizationId: 'org-A', vehicleId: 'v_A', type: 'oil', blockVehicle: false,
        createdByUid: 'emp_1', cost: -50000,
      });
    });

    const empDb = setupContext('emp_1', { role: 'employee', orgId: 'org-A' }).firestore();

    // ── 주유 기록 ──
    await assertSucceeds(empDb.collection('fuelLogs').doc('f_ok').set({
      organizationId: 'org-A', vehicleId: 'v_A', driverUid: 'emp_1',
      meterReading: 51000, fuelAmount: 40, fuelCost: 60000,
    }));
    await assertFails(empDb.collection('fuelLogs').doc('f_cost').set({
      organizationId: 'org-A', vehicleId: 'v_A', driverUid: 'emp_1',
      meterReading: 51000, fuelAmount: 40, fuelCost: -60000,
    }));
    await assertFails(empDb.collection('fuelLogs').doc('f_amount').set({
      organizationId: 'org-A', vehicleId: 'v_A', driverUid: 'emp_1',
      meterReading: 51000, fuelAmount: -40, fuelCost: 60000,
    }));
    await assertFails(empDb.collection('fuelLogs').doc('f_meter').set({
      organizationId: 'org-A', vehicleId: 'v_A', driverUid: 'emp_1',
      meterReading: -51000, fuelAmount: 40, fuelCost: 60000,
    }));
    // 수정으로 음수를 밀어 넣는 것도 차단
    await assertFails(empDb.collection('fuelLogs').doc('f_ok').update({ fuelCost: -1 }));

    // ── 하이패스 충전 기록 ──
    await assertSucceeds(empDb.collection('hipassCharges').doc('h_ok').set({
      organizationId: 'org-A', cardId: 'c_A', chargerUid: 'emp_1', chargeAmount: 50000,
    }));
    await assertFails(empDb.collection('hipassCharges').doc('h_neg').set({
      organizationId: 'org-A', cardId: 'c_A', chargerUid: 'emp_1', chargeAmount: -50000,
    }));

    // ── 정비 기록 ──
    await assertSucceeds(empDb.collection('maintenanceRecords').doc('m_ok').set({
      organizationId: 'org-A', vehicleId: 'v_A', createdByUid: 'emp_1', blockVehicle: false,
      cost: 50000, km: 45000, nextDueKm: 50000,
    }));
    // 미입력(null)은 선택 항목이므로 통과해야 한다
    await assertSucceeds(empDb.collection('maintenanceRecords').doc('m_null').set({
      organizationId: 'org-A', vehicleId: 'v_A', createdByUid: 'emp_1', blockVehicle: false,
      cost: null, km: null, nextDueKm: null,
    }));
    await assertFails(empDb.collection('maintenanceRecords').doc('m_cost').set({
      organizationId: 'org-A', vehicleId: 'v_A', createdByUid: 'emp_1', blockVehicle: false,
      cost: -50000,
    }));
    await assertFails(empDb.collection('maintenanceRecords').doc('m_km').set({
      organizationId: 'org-A', vehicleId: 'v_A', createdByUid: 'emp_1', blockVehicle: false,
      km: -100,
    }));

    // 이미 음수가 박힌 옛 기록의 **다른 필드** 수정은 여전히 허용 (Phase 129·132의 함정 회피)
    await assertSucceeds(empDb.collection('maintenanceRecords').doc('m_legacy').update({ description: '설명만 수정' }));
    // 같은 기록이라도 음수를 새로 밀어 넣는 수정은 차단
    await assertFails(empDb.collection('maintenanceRecords').doc('m_legacy').update({ km: -1 }));
  });

  it('9. 운행일지 대표 운전자 지정/수정 권한 (작성자·관리자, 구 데이터 폴백)', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('vehicles').doc('v_A').set({ organizationId: 'org-A', plateNumber: '1', currentKm: 10 });
      // 구 데이터: createdByUid 없음, driverUid=본인
      await db.collection('driveLogs').doc('legacy_mine').set({
        organizationId: 'org-A', vehicleId: 'v_A', driverUid: 'user_A', startKm: 0, endKm: 10,
      });
      // 구 데이터: createdByUid 없음, driverUid=타인
      await db.collection('driveLogs').doc('legacy_other').set({
        organizationId: 'org-A', vehicleId: 'v_A', driverUid: 'user_X', startKm: 0, endKm: 10,
      });
      // 신 데이터: user_A가 작성, 대표 운전자는 타인(user_X)
      await db.collection('driveLogs').doc('owned_by_A').set({
        organizationId: 'org-A', vehicleId: 'v_A', driverUid: 'user_X', createdByUid: 'user_A', startKm: 0, endKm: 10,
      });
    });

    const memberA = setupContext('user_A', { role: 'member', orgId: 'org-A' }).firestore();
    const memberC = setupContext('user_C', { role: 'member', orgId: 'org-A' }).firestore();
    const adminA = setupContext('admin_A', { role: 'admin', orgId: 'org-A' }).firestore();

    // (1) 작성자가 타인을 대표 운전자로 지정해 생성 → 허용 (createdByUid=본인)
    await assertSucceeds(memberA.collection('driveLogs').doc('new_A').set({
      organizationId: 'org-A', vehicleId: 'v_A',
      driverUid: 'user_X', createdByUid: 'user_A', startKm: 10, endKm: 20,
    }));

    // (2) 작성자 본인 소유 일지의 대표 운전자 변경 → 허용
    await assertSucceeds(memberA.collection('driveLogs').doc('owned_by_A').update({ driverUid: 'user_Y' }));

    // (3) 비소유자·비관리자의 대표 운전자 변경 시도 → 차단
    await assertFails(memberC.collection('driveLogs').doc('owned_by_A').update({ driverUid: 'user_C' }));

    // (4) 구 데이터(createdByUid 없음)에서 driverUid==본인이면 폴백으로 수정 허용
    await assertSucceeds(memberA.collection('driveLogs').doc('legacy_mine').update({ driverUid: 'user_Y' }));

    // (5) 구 데이터에서 driverUid가 타인이면 비관리자는 수정 불가
    await assertFails(memberC.collection('driveLogs').doc('legacy_other').update({ driverUid: 'user_C' }));

    // (6) 관리자는 타인 소유 일지의 대표 운전자 변경 가능
    await assertSucceeds(adminA.collection('driveLogs').doc('owned_by_A').update({ driverUid: 'user_Z' }));

    // (7) createdByUid는 불변 (소유자도 변경 불가)
    await assertFails(memberA.collection('driveLogs').doc('owned_by_A').update({ createdByUid: 'user_C' }));

    // (8) 슈퍼관리자는 소속 기관이 없어도 어느 기관에든 운행일지 생성 가능 (지원·테스트용)
    const superAdmin = setupContext('sa_1', { role: 'superAdmin' }).firestore();
    await assertSucceeds(superAdmin.collection('driveLogs').doc('sa_log').set({
      organizationId: 'org-A', vehicleId: 'v_A',
      driverUid: 'user_X', createdByUid: 'sa_1', startKm: 20, endKm: 30,
    }));

    // (9) 슈퍼관리자도 작성자(createdByUid) 위조는 불가
    await assertFails(superAdmin.collection('driveLogs').doc('sa_forge').set({
      organizationId: 'org-A', vehicleId: 'v_A',
      driverUid: 'user_X', createdByUid: 'someone_else', startKm: 20, endKm: 30,
    }));
  });

  it('13. 메신저 어시스턴트 서버 전용 컬렉션 — 클라이언트 접근 전면 차단', async () => {
    // 연동 매핑·매핑 캐시·task 큐·확인 문서는 Functions(Admin SDK) 전용이며
    // 어떤 역할의 클라이언트도 읽거나 쓸 수 없어야 한다.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('integrations').doc('slack_T123').set({ organizationId: 'org-A', enabled: true });
      await db.collection('slackUsers').doc('T123_U1').set({ uid: 'user_A', email: 'a@x.com' });
      await db.collection('slackTasks').doc('Ev1').set({ kind: 'message', teamId: 'T123' });
      await db.collection('slackConfirmations').doc('conf1').set({ slackUserId: 'U1', status: 'pending' });
      await db.collection('tmapCache').doc('hash1').set({ value: { lat: 37.5, lon: 127 }, expiresAt: new Date() });
    });

    // 슈퍼관리자조차 접근 불가 (전면 false)
    const superDb = setupContext('super_1', { role: 'superAdmin' }).firestore();
    await assertFails(superDb.collection('integrations').doc('slack_T123').get());
    await assertFails(superDb.collection('slackTasks').doc('Ev1').get());

    // 일반 사용자의 읽기·쓰기 모두 차단
    const memberDb = setupContext('user_A', { role: 'employee', orgId: 'org-A' }).firestore();
    await assertFails(memberDb.collection('integrations').doc('slack_T123').get());
    await assertFails(memberDb.collection('slackUsers').doc('T123_U1').get());
    await assertFails(memberDb.collection('slackConfirmations').doc('conf1').get());
    // TMAP 캐시 — 기관 주소·목적지 좌표가 담기므로 클라이언트가 훑어볼 수 있으면 안 된다
    await assertFails(memberDb.collection('tmapCache').doc('hash1').get());
    await assertFails(memberDb.collection('tmapCache').doc('hash2').set({ value: null, expiresAt: new Date() }));

    // 특히 예약 확인 문서를 임의 생성해 예약을 밀어넣는 우회 시도 → 차단
    await assertFails(memberDb.collection('slackConfirmations').doc('conf_evil').set({
      slackUserId: 'U1', status: 'pending', proposal: { organizationId: 'org-A', vehicleId: 'v_A' },
    }));
    // integrations 위조로 타 워크스페이스를 자기 기관에 연결하는 시도 → 차단
    await assertFails(memberDb.collection('integrations').doc('slack_EVIL').set({
      organizationId: 'org-A', enabled: true,
    }));
  });

  it('21. 도착 km < 출발 km — 불가능한 값을 서버에서 끊는다 (정상 경로는 열어 둔다)', async () => {
    // 화면(validateDriveLogForm)이 이미 막지만 클라이언트를 우회하면 통과했다.
    // 목적은 위조 차단이 아니라 정합성이다 — 내보내기가 음수 주행거리를 방어할 필요가 없어진다.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('vehicles').doc('v_A').set({ organizationId: 'org-A', plateNumber: '1', currentKm: 143 });
      await db.collection('users').doc('user_A').set({ organizationId: 'org-A', name: '직원A', email: 'a@t.kr', role: 'employee' });
      // 정상 기록
      await db.collection('driveLogs').doc('log_ok').set({
        organizationId: 'org-A', vehicleId: 'v_A', driverUid: 'user_A', createdByUid: 'user_A', startKm: 100, endKm: 143,
      });
      // 규칙 도입 전에 들어간 '이미 어긋난' 기록 — 이걸 손볼 길이 막히면 안 된다
      await db.collection('driveLogs').doc('log_broken').set({
        organizationId: 'org-A', vehicleId: 'v_A', driverUid: 'user_A', createdByUid: 'user_A', startKm: 143, endKm: 140,
      });
    });

    const memberA = setupContext('user_A', { role: 'member', orgId: 'org-A' }).firestore();
    const base = { organizationId: 'org-A', vehicleId: 'v_A', driverUid: 'user_A', createdByUid: 'user_A' };

    // (1) 생성: 도착 < 출발 → 차단
    await assertFails(memberA.collection('driveLogs').doc('new_bad').set({ ...base, startKm: 143, endKm: 140 }));

    // (2) 생성: 도착 >= 출발 → 허용 (같은 값도 허용 — 제자리 운행)
    await assertSucceeds(memberA.collection('driveLogs').doc('new_ok').set({ ...base, startKm: 143, endKm: 143 }));

    // (3) 생성: 도착 km가 아직 없는 기록 → 허용. 두 필드가 다 있을 때만 비교한다.
    await assertSucceeds(memberA.collection('driveLogs').doc('new_partial').set({ ...base, startKm: 143 }));

    // (4) 수정: 도착을 출발보다 작게 → 차단
    await assertFails(memberA.collection('driveLogs').doc('log_ok').update({ endKm: 50 }));

    // (5) 수정: 출발을 도착보다 크게 → 차단 (반대 방향도 막힌다)
    await assertFails(memberA.collection('driveLogs').doc('log_ok').update({ startKm: 200 }));

    // (6) 수정: 정상 범위 → 허용
    await assertSucceeds(memberA.collection('driveLogs').doc('log_ok').update({ endKm: 150 }));

    // (7) **이미 어긋난 기록의 다른 필드 수정 → 허용.** 이걸 막으면 그 기록을 아예
    //     손볼 수 없게 된다(Phase 129·132의 함정). km를 건드릴 때만 순서를 검사한다.
    await assertSucceeds(memberA.collection('driveLogs').doc('log_broken').update({ destination: '서울역' }));

    // (8) 어긋난 기록을 바로잡는 수정 → 허용
    await assertSucceeds(memberA.collection('driveLogs').doc('log_broken').update({ endKm: 145 }));
  });

  /**
   * 의견(feedbacks) 생성이 **서버 비용을 부르는 쓰기**라는 점을 규칙으로 못박는다.
   *
   * 이 컬렉션의 onCreate(generateFeedbackDraft)는 Discord 웹훅·첨부 다운로드·Gemini 호출을
   * 연쇄로 실행한다. 규칙이 `isSignedIn()` 하나였을 때는 로그인한 누구나 타인 명의로,
   * 첨부 개수·본문 길이 제한 없이 그 연쇄를 무제한 유발할 수 있었다 (2026-08-14 감사 발견 1).
   *
   * 호출 '횟수' 상한은 Rules로 표현할 수 없어 트리거 안의 일일 쿼터가 맡는다. 여기서는
   * 한 번의 쓰기가 시킬 수 있는 일의 크기와 명의를 검증한다.
   */
  it('11. 의견 생성 — 명의 위조·첨부 과다·AI 필드 선점 차단', async () => {
    const author = setupContext('user_A', { role: 'member', orgId: 'org-A' }).firestore();
    const base = {
      message: '건의드립니다',
      imageUrls: [] as string[],
      userEmail: 'a@example.com',
      userName: '사용자A',
      organizationId: 'org-A',
      authorUid: 'user_A',
      status: 'unread',
    };

    // (1) 정상 경로(FeedbackForm이 보내는 모양) → 허용. 이게 막히면 의견 기능이 죽는다.
    await assertSucceeds(author.collection('feedbacks').doc('fb_ok').set(base));

    // (2) 첨부 3개까지 → 허용 (트리거 fetchPromptImages의 maxImages와 같은 값)
    await assertSucceeds(author.collection('feedbacks').doc('fb_img3').set({
      ...base, imageUrls: ['https://a/1.jpg', 'https://a/2.jpg', 'https://a/3.jpg'],
    }));

    // (3) 타인 명의로 심기 → 차단
    await assertFails(author.collection('feedbacks').doc('fb_forged').set({ ...base, authorUid: 'user_B' }));

    // (4) 첨부 4개 이상 → 차단 (쓰기 1건이 시키는 다운로드·토큰 비용의 상한)
    await assertFails(author.collection('feedbacks').doc('fb_img4').set({
      ...base, imageUrls: ['https://a/1.jpg', 'https://a/2.jpg', 'https://a/3.jpg', 'https://a/4.jpg'],
    }));

    // (5) 본문 길이 상한 초과 → 차단
    await assertFails(author.collection('feedbacks').doc('fb_long').set({ ...base, message: 'x'.repeat(5001) }));

    // (6) AI·답변 필드 선점 → 차단 (답변 이력이 사용자 입력으로 오염되는 것을 막는다)
    await assertFails(author.collection('feedbacks').doc('fb_ai').set({ ...base, aiDraft: '내가 쓴 초안' }));
    await assertFails(author.collection('feedbacks').doc('fb_reply').set({ ...base, reply: '처리 완료' }));

    // (7) 읽기는 여전히 superAdmin 전용 — 작성자 본인도 못 읽는다
    await assertFails(author.collection('feedbacks').doc('fb_ok').get());
  });

  it('22. 기관 신청서(orgApplications) — 남의 신청서를 이메일 위조로 열지 못한다', async () => {
    // 이 컬렉션은 신청자 이메일·연락처가 담긴 개인정보다. 조건이 단순 소유권(uid)이 아니라
    // **토큰의 email과 문서의 applicantEmail 일치**라 실수 여지가 커서 따로 고정한다.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().collection('orgApplications').doc('app_kim').set({
        applicantEmail: 'kim@a.or.kr',
        orgName: '가나복지관',
        phone: '010-1111-2222',
        status: 'pending',
      });
    });

    const kim = setupContext('uid_kim', { email: 'kim@a.or.kr' }).firestore();
    const lee = setupContext('uid_lee', { email: 'lee@b.or.kr' }).firestore();
    const superAdmin = setupContext('uid_root', { role: 'superAdmin' }).firestore();

    // (1) 본인 신청서는 읽을 수 있다
    await assertSucceeds(kim.collection('orgApplications').doc('app_kim').get());
    // (2) 남의 신청서는 못 읽는다 — 개인정보 노출 경로
    await assertFails(lee.collection('orgApplications').doc('app_kim').get());
    // (3) superAdmin은 심사해야 하므로 읽는다
    await assertSucceeds(superAdmin.collection('orgApplications').doc('app_kim').get());

    // (4) 생성은 본인 이메일 명의만 — 남의 이메일로 접수할 수 없다
    await assertSucceeds(kim.collection('orgApplications').doc('app_new').set({
      applicantEmail: 'kim@a.or.kr', orgName: '새복지관', status: 'pending',
    }));
    await assertFails(lee.collection('orgApplications').doc('app_forge').set({
      applicantEmail: 'kim@a.or.kr', orgName: '위조', status: 'pending',
    }));

    // (5) 심사 결과 변경(update)·삭제는 superAdmin만 — 신청자가 스스로 승인할 수 없다
    await assertFails(kim.collection('orgApplications').doc('app_kim').update({ status: 'approved' }));
    await assertSucceeds(superAdmin.collection('orgApplications').doc('app_kim').update({ status: 'approved' }));
    await assertFails(kim.collection('orgApplications').doc('app_kim').delete());
    await assertSucceeds(superAdmin.collection('orgApplications').doc('app_kim').delete());
  });

  it('23. users/{uid}/private — superAdmin도 예외가 아니다 (11번 보완)', async () => {
    // 11번이 본인·같은 기관 멤버 차단을 이미 고정한다. 여기서 더하는 것은 **superAdmin**이다 —
    // 전체 데이터 읽기 권한을 가진 역할이라 "관리자니까 열어 준다"로 뚫리기 쉬운 자리인데,
    // 이 컬렉션은 Google OAuth 리프레시 토큰이라 열리면 계정 임퍼소네이션이 된다
    // (2026-07-10 감사 #4). 부모 문서 읽기가 정상임도 함께 고정해, private만 닫힌 것임을 밝힌다.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('users').doc('uid_owner').set({ email: 'o@a.or.kr', organizationId: 'org-A' });
      await db.collection('users').doc('uid_owner').collection('private').doc('googleOauth').set({
        refreshToken: 'SECRET',
      });
    });

    const owner = setupContext('uid_owner', { orgId: 'org-A' }).firestore();
    const sameOrg = setupContext('uid_peer', { orgId: 'org-A' }).firestore();
    const superAdmin = setupContext('uid_root', { role: 'superAdmin' }).firestore();

    const path = (db: typeof owner) =>
      db.collection('users').doc('uid_owner').collection('private').doc('googleOauth');

    // 본인조차 읽을 수 없다 — 토큰은 서버만 만진다
    await assertFails(path(owner).get());
    await assertFails(path(sameOrg).get());
    await assertFails(path(superAdmin).get());

    // 쓰기도 전면 차단 (본인 명의로도 심을 수 없다)
    await assertFails(path(owner).set({ refreshToken: 'INJECTED' }));
    await assertFails(path(superAdmin).set({ refreshToken: 'INJECTED' }));

    // 부모 문서 읽기는 여전히 정상 — private만 닫힌 것이다
    await assertSucceeds(owner.collection('users').doc('uid_owner').get());
  });

  it('24. organizations 하위 컬렉션 — 읽기는 멤버, 쓰기는 관리자(stats는 서버 전용)', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('organizations').doc('org-A').set({ name: '가나복지관', status: 'approved' });
      await db.collection('organizations').doc('org-A').collection('customHolidays').doc('h1').set({ date: '2026-09-01' });
      await db.collection('organizations').doc('org-A').collection('preRegistered').doc('p1').set({ email: 'new@a.or.kr' });
      await db.collection('organizations').doc('org-A').collection('stats').doc('s1').set({ totalLogs: 10 });
    });

    const employee = setupContext('uid_emp', { orgId: 'org-A', role: 'employee' }).firestore();
    const orgAdmin = setupContext('uid_adm', { orgId: 'org-A', role: 'admin' }).firestore();
    const otherOrg = setupContext('uid_out', { orgId: 'org-B', role: 'admin' }).firestore();
    const sub = (db: typeof employee, name: string, id: string) =>
      db.collection('organizations').doc('org-A').collection(name).doc(id);

    // 커스텀 휴일 — 멤버 읽기, 관리자 쓰기
    await assertSucceeds(sub(employee, 'customHolidays', 'h1').get());
    await assertFails(sub(otherOrg, 'customHolidays', 'h1').get());
    await assertFails(sub(employee, 'customHolidays', 'h2').set({ date: '2026-09-02' }));
    await assertSucceeds(sub(orgAdmin, 'customHolidays', 'h2').set({ date: '2026-09-02' }));

    // 사전 등록 — 직원 이메일이 담기므로 타 기관 차단
    await assertSucceeds(sub(employee, 'preRegistered', 'p1').get());
    await assertFails(sub(otherOrg, 'preRegistered', 'p1').get());
    await assertSucceeds(sub(orgAdmin, 'preRegistered', 'p2').set({ email: 'x@a.or.kr' }));
    await assertFails(sub(employee, 'preRegistered', 'p3').set({ email: 'y@a.or.kr' }));

    // 집계 통계 — 읽기는 멤버, 쓰기는 아무도 못 한다(Cloud Functions 전용)
    await assertSucceeds(sub(employee, 'stats', 's1').get());
    await assertFails(sub(otherOrg, 'stats', 's1').get());
    await assertFails(sub(orgAdmin, 'stats', 's1').update({ totalLogs: 999 }));
  });

  it('25. 즐겨찾기·월별 집계·시스템 문서 — 소유자/멤버 경계와 서버 전용 쓰기', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('favorites').doc('f_mine').set({ userId: 'uid_me', label: '집' });
      await db.collection('orgStats').doc('org-A').collection('monthly').doc('2026-08').set({ logs: 5 });
      await db.collection('system').doc('holidays').set({ '2026-09-01': '임시공휴일' });
      await db.collection('system').doc('secretConfig').set({ token: 'SECRET' });
    });

    const me = setupContext('uid_me', { orgId: 'org-A' }).firestore();
    const other = setupContext('uid_other', { orgId: 'org-A' }).firestore();
    const superAdmin = setupContext('uid_root', { role: 'superAdmin' }).firestore();

    // 즐겨찾기 — 같은 기관이어도 남의 것은 못 읽고 못 지운다 (주소는 개인 정보다)
    await assertSucceeds(me.collection('favorites').doc('f_mine').get());
    await assertFails(other.collection('favorites').doc('f_mine').get());
    await assertFails(other.collection('favorites').doc('f_mine').delete());
    await assertSucceeds(me.collection('favorites').doc('f_mine').delete());
    // 명의 위조 생성 차단
    await assertFails(other.collection('favorites').doc('f_forge').set({ userId: 'uid_me', label: '위조' }));

    // 월별 집계 — 멤버 읽기 가능, 클라이언트 쓰기는 전면 차단
    await assertSucceeds(me.collection('orgStats').doc('org-A').collection('monthly').doc('2026-08').get());
    await assertFails(me.collection('orgStats').doc('org-A').collection('monthly').doc('2026-08').update({ logs: 99 }));
    // 타 기관 집계는 못 읽는다
    const outsider = setupContext('uid_b', { orgId: 'org-B' }).firestore();
    await assertFails(outsider.collection('orgStats').doc('org-A').collection('monthly').doc('2026-08').get());

    // system — holidays만 로그인 사용자에게 열려 있고, 나머지 문서는 superAdmin 전용
    await assertSucceeds(me.collection('system').doc('holidays').get());
    await assertFails(me.collection('system').doc('secretConfig').get());
    await assertSucceeds(superAdmin.collection('system').doc('secretConfig').get());
    // 공휴일도 클라이언트가 고칠 수는 없다
    await assertFails(superAdmin.collection('system').doc('holidays').update({ hacked: true }));
  });

});
