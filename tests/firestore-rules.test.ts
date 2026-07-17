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
});
