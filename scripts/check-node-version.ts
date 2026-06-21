/**
 * Node 버전 가드 — 프로젝트 권장 메이저(22)와 현재 런타임을 비교한다.
 *
 * Node 24+에서는 Rollup 빌드가 실패하므로(CLAUDE.md 참고), 빌드/테스트 전에
 * 버전 불일치를 조기에 경고한다. 기본은 경고만 출력하고 종료 코드 0을 유지하여
 * 기존 워크플로(npm run build 등)를 막지 않는다. `--strict` 플래그를 주면
 * 불일치 시 종료 코드 1로 실패시킨다(CI나 의도적 게이트용).
 *
 * 사용법:
 *   tsx scripts/check-node-version.ts            # 경고만
 *   tsx scripts/check-node-version.ts --strict   # 불일치 시 실패
 */
const REQUIRED_MAJOR = 22;

function main() {
    const strict = process.argv.includes('--strict');
    const current = process.versions.node;
    const major = Number(current.split('.')[0]);

    if (major === REQUIRED_MAJOR) {
        return;
    }

    const hint = major > REQUIRED_MAJOR
        ? `Node ${major}는 Rollup 빌드 실패 가능성이 있습니다.`
        : `Node ${major}는 권장 버전보다 낮습니다.`;

    const lines = [
        '',
        `⚠️  Node 버전 불일치: 현재 v${current}, 권장 v${REQUIRED_MAJOR}.x`,
        `   ${hint}`,
        '   다음으로 전환하세요:  fnm use 22   (또는 nvm use 22)',
        '',
    ];
    console.warn(lines.join('\n'));

    if (strict) {
        process.exit(1);
    }
}

main();
