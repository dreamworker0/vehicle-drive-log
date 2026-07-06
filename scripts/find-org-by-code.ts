/**
 * find-org-by-code — 초대 코드로 기관을 조회 (읽기 전용, 일회성 운영 스크립트)
 *
 * 사용법: fnm exec --using=22 npx tsx scripts/find-org-by-code.ts <초대코드>
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp();
const db = getFirestore();

const code = (process.argv[2] || '').toUpperCase();
if (!code) {
  console.error('사용법: tsx scripts/find-org-by-code.ts <초대코드>');
  process.exit(1);
}

async function main() {
  const snap = await db.collection('organizations').where('inviteCode', '==', code).get();
  if (snap.empty) {
    console.log(`초대 코드 ${code} 로 등록된 기관이 없습니다.`);
    return;
  }
  for (const doc of snap.docs) {
    const o = doc.data();
    console.log(`\n[기관] ${o.name}`);
    console.log('  organizationId :', doc.id);
    console.log('  status         :', o.status);
    console.log('  inviteCode     :', o.inviteCode);

    const members = await db.collection('users').where('organizationId', '==', doc.id).get();
    const admins = members.docs.filter((d) => d.data().role === 'admin');
    console.log(`  활성 멤버 수    : ${members.size} (관리자 ${admins.length}명)`);
    admins.forEach((d) => console.log(`    - admin: ${d.data().name} <${d.data().email}>`));
  }
}

main().catch(console.error);
