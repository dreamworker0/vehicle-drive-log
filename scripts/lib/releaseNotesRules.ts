/**
 * 업데이트 소식 누락 감지의 **판정 규칙** — 순수 함수만 둔다.
 *
 * CLI(`scripts/check-release-notes.ts`)와 단위 테스트가 같은 규칙을 쓰게 하려고 분리했다.
 * Node API(`process`·`child_process`)를 쓰지 않으므로 앱 tsconfig에서도 그대로 타입 검사된다.
 */

/** 사용자 화면·알림에 닿는 경로. 테스트·문서·하네스는 공지 대상이 아니다. */
const USER_FACING = [
    /^src\/components\//,
    /^src\/pages\//,
    /^src\/hooks\//,
    /^src\/lib\//,
    /^src\/store\//,
    // 공지 파일 자신은 제외 — 자기 변경이 후보를 만들면 게이트가 스스로를 물게 된다
    /^public\/(?!data\/releaseNotes\.json)/,
    // 알림톡·이메일·푸시처럼 사용자에게 직접 도달하는 서버 경로
    /^functions\/src\/handlers\//,
    /^functions\/src\/services\//,
];

const EXCLUDED = [
    /^src\/__tests__\//,
    /\.test\.(ts|tsx)$/,
    /\.spec\.(ts|tsx)$/,
    /^functions\/src\/__tests__\//,
];

/** 공지 후보로 볼 커밋 유형 — 기능 추가와 사용자에게 보이는 수정만 */
const ANNOUNCEABLE_TYPE = /^(feat|fix)(\([^)]*\))?!?:/;

export function isUserFacingPath(path: string): boolean {
    if (EXCLUDED.some(re => re.test(path))) return false;
    return USER_FACING.some(re => re.test(path));
}

export function isAnnounceableSubject(subject: string): boolean {
    return ANNOUNCEABLE_TYPE.test(subject);
}
