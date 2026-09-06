/**
 * FAQ 누락 가드 — 새 기능이 자주 하는 질문에 실리지 않은 채 배포되는 것을 막는다.
 *
 * 공지(업데이트 소식)는 그때 한 번 읽고 마는 글이고, 나중에 "이거 어떻게 쓰나요"를 찾아보는
 * 곳은 FAQ다. 실제로 출발지·분관 기능은 공지가 네 번 나가는 동안 FAQ 항목이 하나도 없었다
 * (2026-09-06 발견). 하이패스 잔액 결함도 공지에는 "관리자가 직접 맞춰 주세요"라고 적었는데
 * FAQ에는 없어서, 나중에 잔액이 안 맞는 기관이 찾아볼 곳이 없었다.
 *
 * 판정 방법: `public/data/releaseNotes.json`의 새 기능 항목(`type: "new"`)에 그것을 설명하는
 * FAQ id를 적게 한다(`faq: ["multiday-drive-log"]`). 설명할 FAQ가 필요 없다고 판단했으면
 * 빈 배열(`faq: []`)을 적는다. **이 스크립트는 필요 여부를 판단하지 않는다** — 판단을
 * 건너뛴 것만 잡는다. 함께 존재하지 않는 FAQ를 가리키는 연결(이름 변경·삭제)도 잡는다.
 *
 * 판정 규칙은 `scripts/lib/faqCoverageRules.ts`에 있다 — 단위 테스트가 같은 규칙을 본다.
 *
 * 사용법:
 *   tsx scripts/check-faq-coverage.ts          # 누락이 있으면 종료 코드 1 (배포 게이트)
 *   tsx scripts/check-faq-coverage.ts --soft   # 보고만 하고 항상 0 (참고용)
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAQ_ITEMS } from '../shared/faqData';
import {
    FAQ_COVERAGE_SINCE, findMissingLinks, findDanglingLinks,
    type ReleaseNoteEntry,
} from './lib/faqCoverageRules';

const NOTES_PATH = 'public/data/releaseNotes.json';

function main() {
    const soft = process.argv.includes('--soft');

    if (!existsSync(join(process.cwd(), NOTES_PATH))) {
        console.error(`❌ ${NOTES_PATH}를 찾을 수 없습니다. 저장소 루트에서 실행하세요.`);
        process.exit(1);
    }

    const notes = JSON.parse(readFileSync(join(process.cwd(), NOTES_PATH), 'utf8')) as ReleaseNoteEntry[];
    const faqIds = FAQ_ITEMS.map(item => item.id);

    const missing = findMissingLinks(notes);
    const dangling = findDanglingLinks(notes, faqIds);

    if (missing.length === 0 && dangling.length === 0) {
        console.log(`✅ 새 기능 공지가 모두 FAQ와 연결돼 있습니다 (${FAQ_COVERAGE_SINCE} 이후 기준, FAQ ${faqIds.length}개).`);
        return;
    }

    console.warn('');
    if (missing.length > 0) {
        console.warn(`⚠️  FAQ 연결을 적지 않은 새 기능 공지 ${missing.length}건`);
        console.warn('');
        for (const gap of missing) {
            console.warn(`   · ${gap.date} ${gap.title}`);
            console.warn(`     ${gap.text.slice(0, 70)}${gap.text.length > 70 ? '…' : ''}`);
        }
        console.warn('');
        console.warn(`   → 그 기능을 설명하는 FAQ의 id를 항목에 적으세요: "faq": ["some-faq-id"]`);
        console.warn('     FAQ가 필요 없다고 판단했으면 빈 배열을 적으세요: "faq": []');
        console.warn('     FAQ 작성 규칙: .agent/skills/update-faq/SKILL.md');
        console.warn('');
    }
    if (dangling.length > 0) {
        console.warn(`❌ 존재하지 않는 FAQ를 가리키는 연결 ${dangling.length}건`);
        console.warn('');
        for (const link of dangling) {
            console.warn(`   · ${link.date} ${link.title} → "${link.faqId}"`);
        }
        console.warn('');
        console.warn('   → FAQ의 id가 바뀌었거나 항목이 지워졌습니다. 연결을 고치세요.');
        console.warn('');
    }

    if (!soft) process.exit(1);
}

// 직접 실행할 때만 검사한다 — 판정 함수는 단위 테스트가 import한다(check-release-notes.ts와 같은 관례)
const selfPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === selfPath.toLowerCase()) {
    main();
}
