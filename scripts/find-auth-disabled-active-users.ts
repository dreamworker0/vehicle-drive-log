/**
 * find-auth-disabled-active-users — 목록은 '활성'인데 로그인이 막힌 직원을 찾는다 (일회성 운영 스크립트)
 *
 * ## 배경 (2026-11-18 기관 문의)
 * 비활성화(disableUser)는 users 문서 status='disabled'와 함께 **Auth 계정도 막는다**(2026-07-10 감사 #1
 * 이후). 그런데 관리자 화면의 [다시 활성화]는 클라이언트가 문서만 status='active'로 고쳤다. 그래서
 * 한 번 비활성화했다가 다시 활성화한 직원은 관리자 목록엔 '활성'인데 Google 로그인이 auth/user-disabled로
 * 실패해 아무 안내 없이 로그인 화면으로 되돌아왔다. 재활성화는 enableUser 콜러블로 고쳤고, 이 스크립트는
 * 그 전에 이미 반쪽 복구된 계정을 찾는다.
 *
 * ## 판정
 * Auth disabled=true 인 계정을 전부 훑어 users 문서와 대조한다.
 *   - 피해: 문서가 있고 status != 'disabled'  ← 이 스크립트의 대상
 *   - 정상: 문서 status == 'disabled' (비활성 직원 — Auth도 막혀 있어야 맞다)
 *   - 문서 없음: 참고용으로 건수만 보인다(익명·탈퇴 계정 등 — 복구 대상 아님)
 *
 * ## 사용법 (프로젝트 루트에서, ADC/서비스계정 설정된 상태)
 *   npx tsx scripts/find-auth-disabled-active-users.ts          # 읽기 전용(기본)
 *   npx tsx scripts/find-auth-disabled-active-users.ts --fix    # 피해 계정의 Auth 차단만 해제
 *
 * --fix 는 피해 계정 중 **소속 기관이 승인 상태인 계정만** Auth disabled=false로 되돌린다.
 * 문서는 이미 active라 건드리지 않는다. 소속이 비었거나 기관이 승인 상태가 아니면 건너뛰고 목록에 남긴다.
 */
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth, type UserRecord } from 'firebase-admin/auth';
import { initAdminApp } from './lib/adminApp';

initAdminApp();
const db = getFirestore();
const authAdmin = getAuth();

const doFix = process.argv.slice(2).includes('--fix');

/** 이메일 가운데를 가린다 — 터미널 출력이 공유될 수 있다. */
function maskEmail(email: string | undefined): string {
  if (!email) return '(이메일 없음)';
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const shown = local.length <= 2 ? local[0] ?? '' : local.slice(0, 2);
  return `${shown}${'*'.repeat(Math.max(1, local.length - shown.length))}@${domain}`;
}

function fmt(ts: unknown): string {
  const d = (ts as { toDate?: () => Date })?.toDate?.();
  return d ? d.toISOString().slice(0, 10) : ts == null ? '-' : String(ts);
}

async function listDisabledAuthUsers(): Promise<UserRecord[]> {
  const disabled: UserRecord[] = [];
  let total = 0;
  let pageToken: string | undefined;
  do {
    const page = await authAdmin.listUsers(1000, pageToken);
    total += page.users.length;
    disabled.push(...page.users.filter((u) => u.disabled));
    pageToken = page.pageToken;
  } while (pageToken);
  console.log(`Auth 계정 ${total}개 중 disabled ${disabled.length}개`);
  if (total === 0) {
    // adminApp이 프로젝트를 고정하지만, 0건은 조용한 오조회일 수 있으니 분명히 실패로 알린다
    throw new Error('Auth 계정이 0개로 조회됐습니다. 대상 프로젝트·자격 증명을 확인하세요.');
  }
  return disabled;
}

interface Affected {
  uid: string;
  email?: string;
  status: unknown;
  orgId: string | null;
  role: unknown;
  disabledAt: unknown;
  lastSignIn?: string;
}

async function main() {
  console.log(`\n=== 로그인 막힌 '활성' 직원 찾기 ${doFix ? '(--fix: 복구)' : '(읽기 전용)'} ===\n`);

  const disabledUsers = await listDisabledAuthUsers();

  const affected: Affected[] = [];
  let normal = 0;
  let noDoc = 0;

  // getAll은 한 번에 너무 많이 넘기지 않는다
  for (let i = 0; i < disabledUsers.length; i += 100) {
    const chunk = disabledUsers.slice(i, i + 100);
    const snaps = await db.getAll(...chunk.map((u) => db.collection('users').doc(u.uid)));
    snaps.forEach((snap, idx) => {
      const authUser = chunk[idx];
      if (!snap.exists) { noDoc++; return; }
      const d = snap.data()!;
      if (d.status === 'disabled') { normal++; return; }
      affected.push({
        uid: authUser.uid,
        email: authUser.email,
        status: d.status,
        orgId: typeof d.organizationId === 'string' && d.organizationId ? d.organizationId : null,
        role: d.role,
        disabledAt: d.disabledAt,
        lastSignIn: authUser.metadata.lastSignInTime,
      });
    });
  }

  console.log(`  정상(문서도 비활성): ${normal}개`);
  console.log(`  문서 없음(참고):     ${noDoc}개`);
  console.log(`  ⚠️ 피해(문서는 활성, Auth만 막힘): ${affected.length}개\n`);

  // 기관 이름·상태
  const orgIds = [...new Set(affected.map((a) => a.orgId).filter((x): x is string => !!x))];
  const orgInfo = new Map<string, { name: string; status: string }>();
  if (orgIds.length) {
    const orgSnaps = await db.getAll(...orgIds.map((id) => db.collection('organizations').doc(id)));
    orgSnaps.forEach((s) => {
      orgInfo.set(s.id, s.exists
        ? { name: String(s.data()?.name ?? '(이름 없음)'), status: String(s.data()?.status ?? '-') }
        : { name: '(기관 문서 없음)', status: 'missing' });
    });
  }

  // 기관별로 묶어 출력
  const byOrg = new Map<string, Affected[]>();
  for (const a of affected) {
    const key = a.orgId ?? '(소속 없음)';
    byOrg.set(key, [...(byOrg.get(key) ?? []), a]);
  }
  for (const [orgId, list] of byOrg) {
    const info = orgInfo.get(orgId);
    console.log(`[${info?.name ?? orgId}] (${orgId}, 기관 상태: ${info?.status ?? '-'}) — ${list.length}명`);
    for (const a of list) {
      console.log(`   - ${maskEmail(a.email)}  uid=${a.uid}  status=${String(a.status)}  role=${String(a.role)}  disabledAt=${fmt(a.disabledAt)}  최근 로그인=${a.lastSignIn ?? '-'}`);
    }
  }

  if (!doFix) {
    if (affected.length) console.log('\n(읽기 전용) Auth 차단을 풀려면 같은 명령에 --fix 를 붙여 실행하세요.\n');
    return;
  }

  console.log('\n=== --fix: Auth 차단 해제 ===');
  let fixed = 0;
  const skipped: string[] = [];
  for (const a of affected) {
    const info = a.orgId ? orgInfo.get(a.orgId) : undefined;
    if (!a.orgId || info?.status !== 'approved') {
      skipped.push(`${maskEmail(a.email)} (uid=${a.uid}, 소속=${a.orgId ?? '없음'}, 기관 상태=${info?.status ?? '-'})`);
      continue;
    }
    await authAdmin.updateUser(a.uid, { disabled: false });
    fixed++;
    console.log(`✅ ${maskEmail(a.email)} (${info.name}) Auth disabled=false`);
  }
  console.log(`\n복구 ${fixed}개, 건너뜀 ${skipped.length}개`);
  for (const s of skipped) console.log(`   건너뜀: ${s}`);
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
