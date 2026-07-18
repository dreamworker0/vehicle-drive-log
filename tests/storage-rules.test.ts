// @vitest-environment node
import { assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { ref, uploadBytes, getBytes } from 'firebase/storage';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Firebase 에뮬레이터 프로젝트 ID
const PROJECT_ID = 'vehicle-drive-log-test';

// 기관 고유번호증(정부 발급 PII) 경로
const ORG_DOC_PATH = 'organizations/org-A/unique-number.jpg';

let testEnv: RulesTestEnvironment;

describe('Storage Security Rules — 기관 증빙서류(PII) 접근 격리', () => {
  beforeAll(async () => {
    // 에뮬레이터 환경 초기화 (storage.rules 읽어오기)
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      storage: {
        rules: readFileSync(resolve(process.cwd(), 'storage.rules'), 'utf8'),
        host: '127.0.0.1',
        port: 9199,
      },
    });
  });

  beforeEach(async () => {
    await testEnv.clearStorage();
    // 각 테스트 전에 증빙서류 1건을 규칙 우회로 시드한다(업로드는 실서비스에선 Admin SDK가 수행).
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await uploadBytes(ref(context.storage(), ORG_DOC_PATH), new Uint8Array([1, 2, 3]));
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('org 멤버는 자기 기관 증빙서류를 직접 읽을 수 없다 (superAdmin 전용으로 축소)', async () => {
    // given: org-A 소속 일반 멤버
    const memberStorage = testEnv
      .authenticatedContext('user_A', { role: 'member', orgId: 'org-A' })
      .storage();

    // when & then: 자기 기관 경로라도 직접 읽기는 거부되어야 한다 (2026-07-18 보안 재점검 B)
    await assertFails(getBytes(ref(memberStorage, ORG_DOC_PATH)));
  });

  it('org 관리자(admin)도 증빙서류를 직접 읽을 수 없다', async () => {
    const adminStorage = testEnv
      .authenticatedContext('admin_A', { role: 'admin', orgId: 'org-A' })
      .storage();

    await assertFails(getBytes(ref(adminStorage, ORG_DOC_PATH)));
  });

  it('타 기관 멤버는 당연히 읽을 수 없다', async () => {
    const otherOrgStorage = testEnv
      .authenticatedContext('user_B', { role: 'member', orgId: 'org-B' })
      .storage();

    await assertFails(getBytes(ref(otherOrgStorage, ORG_DOC_PATH)));
  });

  it('미인증 사용자는 읽을 수 없다', async () => {
    const anonStorage = testEnv.unauthenticatedContext().storage();

    await assertFails(getBytes(ref(anonStorage, ORG_DOC_PATH)));
  });

  it('superAdmin은 증빙서류를 읽을 수 있다 (회귀 가드 — 정당한 접근 경로 보존)', async () => {
    const superAdminStorage = testEnv
      .authenticatedContext('super_1', { role: 'superAdmin' })
      .storage();

    await assertSucceeds(getBytes(ref(superAdminStorage, ORG_DOC_PATH)));
  });

  it('어떤 클라이언트도 증빙서류 경로에 쓰기할 수 없다 (업로드는 Admin SDK 전용)', async () => {
    const superAdminStorage = testEnv
      .authenticatedContext('super_1', { role: 'superAdmin' })
      .storage();

    // 쓰기는 superAdmin에게도 거부(allow write: if false) — Admin SDK만 업로드
    await assertFails(uploadBytes(ref(superAdminStorage, ORG_DOC_PATH), new Uint8Array([9])));
  });
});
