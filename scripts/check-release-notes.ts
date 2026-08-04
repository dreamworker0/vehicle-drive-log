/**
 * 업데이트 소식 누락 가드 — 사용자 눈에 보이는 변경이 공지 없이 배포되는 것을 막는다.
 *
 * 배포는 됐는데 `업데이트 소식`이 그대로인 일이 실제로 있었다(Phase 143~145: 다섯 건이
 * 프로덕션에 나간 뒤 사용자가 "공지에 설명해 놨니?"라고 물어 발견). 체크리스트에 적어 두는
 * 것만으로는 막히지 않는다 — 잊었는지 여부를 **기계가 판정**해야 한다.
 *
 * 판정 방법: `public/data/releaseNotes.json`을 마지막으로 건드린 커밋 이후의 커밋 중
 * **사용자 화면에 영향을 주는 feat/fix**가 있으면 "공지 미반영 후보"로 보고한다.
 * 코드가 실제로 사용자에게 보이는지는 사람만 알 수 있으므로, 이 스크립트는 **후보를
 * 나열할 뿐 판단하지 않는다.** 공지가 필요 없는 변경이면 그대로 넘어가면 된다.
 *
 * 판정 규칙(경로·커밋 유형)은 `scripts/lib/releaseNotesRules.ts`에 있다 — 단위 테스트가 같은 규칙을 본다.
 *
 * 사용법:
 *   tsx scripts/check-release-notes.ts            # 후보가 있으면 종료 코드 1 (배포 게이트)
 *   tsx scripts/check-release-notes.ts --soft     # 보고만 하고 항상 0 (참고용)
 *   tsx scripts/check-release-notes.ts --base=<ref>  # 비교 기준 커밋 직접 지정
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAnnounceableSubject, isUserFacingPath } from './lib/releaseNotesRules';

const NOTES_PATH = 'public/data/releaseNotes.json';

const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();

function main() {
    const soft = process.argv.includes('--soft');
    const baseArg = process.argv.find(a => a.startsWith('--base='))?.slice('--base='.length);

    if (!existsSync(join(process.cwd(), NOTES_PATH))) {
        console.error(`❌ ${NOTES_PATH}를 찾을 수 없습니다. 저장소 루트에서 실행하세요.`);
        process.exit(1);
    }

    // 공지 파일을 마지막으로 건드린 커밋이 비교 기준이다.
    const base = baseArg || git(['log', '-1', '--format=%H', '--', NOTES_PATH]);
    if (!base) {
        console.warn(`⚠️  ${NOTES_PATH}의 변경 이력을 찾지 못해 검사를 건너뜁니다.`);
        return;
    }

    const range = `${base}..HEAD`;
    const log = git(['log', range, '--format=%H%x1f%s']);
    if (!log) {
        console.log(`✅ 업데이트 소식이 최신입니다 (기준 ${base.slice(0, 7)} 이후 새 커밋 없음).`);
        return;
    }

    const candidates: { sha: string; subject: string; files: string[] }[] = [];
    for (const line of log.split('\n')) {
        const [sha, subject] = line.split('\x1f');
        if (!sha || !isAnnounceableSubject(subject)) continue;

        const files = git(['show', '--name-only', '--format=', sha])
            .split('\n')
            .map(f => f.trim())
            .filter(Boolean)
            .filter(isUserFacingPath);
        if (files.length > 0) candidates.push({ sha, subject, files });
    }

    if (candidates.length === 0) {
        console.log(`✅ 공지 대상 변경이 없습니다 (기준 ${base.slice(0, 7)} 이후 feat/fix 중 사용자 화면 변경 없음).`);
        return;
    }

    const latestNoteDate = (JSON.parse(readFileSync(join(process.cwd(), NOTES_PATH), 'utf8')) as { date: string }[])[0]?.date;

    console.warn('');
    console.warn(`⚠️  업데이트 소식에 반영되지 않은 것으로 보이는 변경 ${candidates.length}건`);
    console.warn(`   최신 공지: ${latestNoteDate ?? '(없음)'} · 비교 기준: ${base.slice(0, 7)} (${NOTES_PATH} 마지막 변경)`);
    console.warn('');
    for (const c of candidates) {
        console.warn(`   · ${c.sha.slice(0, 7)} ${c.subject}`);
        console.warn(`     ${c.files.slice(0, 4).join(', ')}${c.files.length > 4 ? ` … +${c.files.length - 4}` : ''}`);
    }
    console.warn('');
    console.warn(`   → 사용자에게 알릴 내용이면 ${NOTES_PATH}에 항목을 추가하세요.`);
    console.warn('     작성 규칙: .agent/skills/release-notes/SKILL.md');
    console.warn('     알릴 것이 없는 변경이면 그대로 진행해도 됩니다(이 스크립트는 판단하지 않습니다).');
    console.warn('');

    if (!soft) process.exit(1);
}

// 직접 실행할 때만 검사한다 — 판정 함수는 단위 테스트가 import한다(check-harness.ts와 같은 관례)
const selfPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === selfPath.toLowerCase()) {
    main();
}
