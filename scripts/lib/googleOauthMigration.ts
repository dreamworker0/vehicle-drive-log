/**
 * googleOauth → users/{uid}/private/oauth 마이그레이션의 순수 판정 로직.
 *
 * firebase-admin에 의존하지 않는 순수 함수만 분리해 단위 테스트가 가능하도록 한다.
 * 실제 Firestore 읽기/쓰기와 종료 코드 처리는 migrateGoogleOauthToPrivate.ts가 담당한다.
 */

/** 마이그레이션 실행 모드. */
export type MigrationMode = "dry-run" | "verify-only" | "execute";

/**
 * CLI 인자에서 실행 모드를 판정한다.
 * - `--dry-run`: 쓰기 없이 이동 대상만 집계
 * - `--verify-only`: 잔존 토큰 수만 검증 (1건 이상이면 실패로 취급)
 * - 그 외: 실제 이동 실행
 */
export function parseMigrationMode(argv: string[]): MigrationMode {
    if (argv.includes("--dry-run")) return "dry-run";
    if (argv.includes("--verify-only")) return "verify-only";
    return "execute";
}

/**
 * 해당 사용자 문서의 googleOauth 값이 private 서브컬렉션으로 이동할 대상인지 판정한다.
 * refreshToken이 비어 있지 않은 문자열일 때만 이동 대상이다.
 */
export function shouldMoveOauth(oauth: unknown): boolean {
    return Boolean(
        oauth &&
            typeof oauth === "object" &&
            "refreshToken" in oauth &&
            typeof (oauth as { refreshToken?: unknown }).refreshToken === "string" &&
            (oauth as { refreshToken: string }).refreshToken.length > 0,
    );
}
