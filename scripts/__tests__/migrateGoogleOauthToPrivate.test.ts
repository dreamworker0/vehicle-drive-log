import { describe, expect, it } from "vitest";
import { parseMigrationMode, shouldMoveOauth } from "../lib/googleOauthMigration";

describe("Google OAuth private migration", () => {
    it("dry-run에서는 쓰기 없이 이동 대상을 계산한다", () => {
        expect(parseMigrationMode(["--dry-run"])).toBe("dry-run");
        expect(shouldMoveOauth({ refreshToken: "token" })).toBe(true);
    });

    it("verify-only 모드를 인식한다", () => {
        expect(parseMigrationMode(["--verify-only"])).toBe("verify-only");
    });

    it("플래그가 없으면 실제 실행 모드다", () => {
        expect(parseMigrationMode([])).toBe("execute");
        expect(parseMigrationMode(["--other"])).toBe("execute");
    });

    it("refreshToken이 없는 데이터는 이동하지 않는다", () => {
        expect(shouldMoveOauth({ accessToken: "access" })).toBe(false);
        expect(shouldMoveOauth({ refreshToken: "" })).toBe(false);
        expect(shouldMoveOauth({ refreshToken: 123 })).toBe(false);
        expect(shouldMoveOauth(undefined)).toBe(false);
        expect(shouldMoveOauth(null)).toBe(false);
    });
});
