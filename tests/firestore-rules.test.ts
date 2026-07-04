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

    // 타인의 UID로 운행일지 생성 시도
    const spoofedLogWrite = orgAMemberDb.collection('driveLogs').doc('log_spoof').set({
      organizationId: 'org-A',
      vehicleId: 'vehicle_A',
      driverUid: 'user_B_boss', // 타인의 uid 주입
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

    // 본인 조직·본인 명의 정상 생성 허용
    await assertSucceeds(orgAMemberDb.collection('reservations').doc('res_ok').set({
      organizationId: 'org-A',
      vehicleId: 'vehicle_A',
      reservedByUid: 'user_A',
    }));
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
});
