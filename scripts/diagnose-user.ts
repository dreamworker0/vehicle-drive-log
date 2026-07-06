/**
 * diagnose-user — 특정 사용자의 로그인 차단 원인 진단 및 복구 (일회성 운영 스크립트)
 *
 * 로그인이 갑자기 안 되는 직원의 Auth 계정 + Firestore users 문서 + 기관 상태를
 * 한눈에 대조해 원인을 찾는다. 기본은 읽기 전용이며, --fix 플래그를 줄 때만 복구한다.
 *
 * 사용법 (프로젝트 루트에서, ADC/서비스계정 설정된 상태):
 *   fnm exec --using=22 npx tsx scripts/diagnose-user.ts <이메일>
 *   fnm exec --using=22 npx tsx scripts/diagnose-user.ts <이메일> --fix
 *   fnm exec --using=22 npx tsx scripts/diagnose-user.ts <이메일> --fix --org=<organizationId>
 * (인수 순서 무관. organizationId 가 비워진 계정은 --org=<id> 로 되돌릴 기관 지정)
 *
 * --fix 는 다음을 수행한다(복구):
 *   1) Firebase Auth 계정 재활성화(disabled=false)
 *   2) users 문서 status='active', disabledAt=null
 *   3) organizationId 가 비어 있으면 복구 불가 → 안내만 하고 중단(수동 확인 필요)
 *   4) Custom Claims(role, orgId)를 문서와 일치시키고 토큰 무효화(revoke)
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

initializeApp();
const db = getFirestore();
const authAdmin = getAuth();

// 인수는 순서에 무관하게 파싱한다 (플래그가 이메일보다 앞에 와도 동작).
const args = process.argv.slice(2);
const doFix = args.includes('--fix');
// organizationId 가 비워진 계정을 복구할 때, 되돌릴 기관을 명시 지정: --org=<id>
const orgOverride = args.find((a) => a.startsWith('--org='))?.split('=')[1];
// 이메일 = 플래그가 아닌 첫 인수
const email = args.find((a) => !a.startsWith('--'));

if (!email) {
  console.error('사용법: tsx scripts/diagnose-user.ts <이메일> [--fix]');
  process.exit(1);
}

async function main() {
  console.log(`\n=== 사용자 진단: ${email} ===\n`);

  // 1. Firebase Auth 계정
  let authUser;
  try {
    authUser = await authAdmin.getUserByEmail(email);
  } catch (err) {
    console.error('❌ Firebase Auth에 해당 이메일 계정이 없습니다:', (err as Error).message);
    return;
  }
  console.log('[Firebase Auth]');
  console.log('  uid          :', authUser.uid);
  console.log('  disabled     :', authUser.disabled, authUser.disabled ? '  ← ⚠️ Auth 계정이 비활성 상태(로그인 불가)' : '');
  console.log('  customClaims :', JSON.stringify(authUser.customClaims ?? {}));
  console.log('  lastSignIn   :', authUser.metadata.lastSignInTime);

  // 2. Firestore users 문서
  const userRef = db.collection('users').doc(authUser.uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    console.log('\n[Firestore users] ❌ 문서 없음 → 앱은 /invite(초대코드) 화면으로 라우팅');
  } else {
    const u = userSnap.data()!;
    console.log('\n[Firestore users]');
    console.log('  status         :', u.status, u.status === 'disabled' ? '  ← ⚠️ 비활성화 화면 원인' : '');
    console.log('  organizationId :', u.organizationId, !u.organizationId ? '  ← ⚠️ 기관 없음 → /invite 화면으로 라우팅' : '');
    console.log('  role           :', u.role);
    console.log('  disabledAt     :', u.disabledAt?.toDate?.() ?? u.disabledAt);
    console.log('  name           :', u.name);

    // 3. 기관 상태
    if (u.organizationId) {
      const orgSnap = await db.collection('organizations').doc(u.organizationId).get();
      if (!orgSnap.exists) {
        console.log('\n[organizations] ❌ 기관 문서 없음 → 기관 삭제됨 화면');
      } else {
        const o = orgSnap.data()!;
        console.log('\n[organizations]');
        console.log('  name   :', o.name);
        console.log('  status :', o.status, o.status === 'deleted' ? '  ← ⚠️ 기관이 삭제됨' : '');
      }

      // 4. Claims ↔ 문서 정합성
      const claims = authUser.customClaims ?? {};
      const claimMismatch = claims.orgId !== u.organizationId || claims.role !== u.role;
      if (claimMismatch) {
        console.log('\n⚠️ Custom Claims 불일치 — 토큰(orgId/role)이 문서와 다릅니다.');
        console.log(`   claims: role=${claims.role}, orgId=${claims.orgId}`);
        console.log(`   doc   : role=${u.role}, orgId=${u.organizationId}`);
        console.log('   → 기관 데이터 쿼리가 permission-denied 로 막혀 앱이 정상 동작하지 않을 수 있음.');
      }
    }
  }

  if (!doFix) {
    console.log('\n(읽기 전용) 복구하려면 동일 명령에 --fix 를 붙여 실행하세요.\n');
    return;
  }

  // ===== 복구 =====
  console.log('\n=== --fix: 복구 시작 ===');
  const u = userSnap.exists ? userSnap.data()! : null;

  if (!u) {
    console.log('❌ users 문서가 없어 자동 복구를 중단합니다.');
    console.log('   → superAdmin 화면의 "계정 복원"(기관/역할 지정)으로 문서를 재생성하세요.');
    return;
  }

  // 되돌릴 기관: 문서에 남아 있으면 그대로, 비워졌으면 --org 로 지정한 기관을 검증 후 사용
  const targetOrgId: string | null = u.organizationId || orgOverride || null;
  if (!targetOrgId) {
    console.log('❌ organizationId 가 비어 있고 --org 지정도 없어 자동 복구를 중단합니다.');
    console.log('   → 되돌릴 기관을 알면 --org=<organizationId> 를 붙여 다시 실행하세요.');
    return;
  }
  const targetOrgSnap = await db.collection('organizations').doc(targetOrgId).get();
  if (!targetOrgSnap.exists || targetOrgSnap.data()?.status !== 'approved') {
    console.log(`❌ 대상 기관(${targetOrgId})이 없거나 승인 상태가 아닙니다. 복구 중단.`);
    return;
  }
  const targetRole = u.role || 'employee';

  if (authUser.disabled) {
    await authAdmin.updateUser(authUser.uid, { disabled: false });
    console.log('✅ Auth 계정 재활성화(disabled=false)');
  }

  await userRef.update({ organizationId: targetOrgId, role: targetRole, status: 'active', disabledAt: null });
  console.log(`✅ users 문서 organizationId=${targetOrgId}, role=${targetRole}, status=active, disabledAt=null`);

  await authAdmin.setCustomUserClaims(authUser.uid, { role: targetRole, orgId: targetOrgId });
  await authAdmin.revokeRefreshTokens(authUser.uid);
  console.log(`✅ Custom Claims 재설정(role=${targetRole}, orgId=${targetOrgId}) + 토큰 무효화`);
  console.log('\n복구 완료. 직원에게 앱을 완전히 종료 후 다시 로그인하도록 안내하세요.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
