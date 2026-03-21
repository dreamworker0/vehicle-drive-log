/**
 * setCustomClaims 에뮬레이터 통합 테스트
 *
 * users/{uid} 문서 변경 시 Auth Custom Claims가 올바르게 동기화되는지 검증.
 * onDocumentWritten 트리거 로직을 직접 호출하여 테스트.
 */
import {
    initializeTestApp,
    clearFirestoreData,
    clearAuthUsers,
    getTestFirestore,
} from "./emulator.setup";
import { getAuth } from "firebase-admin/auth";

initializeTestApp();

const db = getTestFirestore();
const auth = getAuth();

/**
 * setCustomClaims 트리거의 핵심 로직 재현
 * (onDocumentWritten 래퍼 없이 비즈니스 로직만 테스트)
 */
async function executeSetCustomClaims(params: {
    uid: string;
    before?: { role?: string; organizationId?: string | null } | null;
    after?: { role?: string; organizationId?: string | null } | null;
}) {
    const { uid, before, after } = params;

    try {
        if (!after) {
            // 문서 삭제 → Claims 초기화
            await auth.setCustomUserClaims(uid, {});
            return;
        }

        const newClaims = {
            role: after.role || "employee",
            orgId: after.organizationId || null,
        };

        // 변경 전 Claims와 비교
        if (before) {
            const prevRole = before.role || "employee";
            const prevOrgId = before.organizationId || null;
            if (prevRole === newClaims.role && prevOrgId === newClaims.orgId) {
                return; // 변경 없으면 스킵
            }
        }

        await auth.setCustomUserClaims(uid, newClaims);
    } catch (err: unknown) {
        const authErr = err as { code?: string };
        if (authErr.code === "auth/user-not-found") {
            return; // Auth 계정 없으면 스킵
        }
        throw err;
    }
}

describe("setCustomClaims — 에뮬레이터 통합 테스트", () => {
    beforeEach(async () => {
        await clearFirestoreData();
        await clearAuthUsers();
    });

    afterAll(async () => {
        await clearFirestoreData();
        await clearAuthUsers();
    });

    it("사용자 문서 생성 시 Claims 설정 (role + orgId)", async () => {
        await auth.createUser({ uid: "user-claims-001", email: "c1@example.com" });

        await executeSetCustomClaims({
            uid: "user-claims-001",
            before: null,
            after: { role: "admin", organizationId: "org-001" },
        });

        const user = await auth.getUser("user-claims-001");
        expect(user.customClaims).toEqual({ role: "admin", orgId: "org-001" });
    });

    it("role 변경 시 Claims 업데이트 (employee → admin)", async () => {
        await auth.createUser({ uid: "user-claims-002", email: "c2@example.com" });

        // 초기 설정
        await executeSetCustomClaims({
            uid: "user-claims-002",
            before: null,
            after: { role: "employee", organizationId: "org-001" },
        });

        // role 변경
        await executeSetCustomClaims({
            uid: "user-claims-002",
            before: { role: "employee", organizationId: "org-001" },
            after: { role: "admin", organizationId: "org-001" },
        });

        const user = await auth.getUser("user-claims-002");
        expect(user.customClaims).toEqual({ role: "admin", orgId: "org-001" });
    });

    it("문서 삭제 시 Claims 초기화", async () => {
        await auth.createUser({ uid: "user-claims-003", email: "c3@example.com" });

        // Claims 설정
        await auth.setCustomUserClaims("user-claims-003", { role: "admin", orgId: "org-001" });

        // 문서 삭제
        await executeSetCustomClaims({
            uid: "user-claims-003",
            before: { role: "admin", organizationId: "org-001" },
            after: null,
        });

        const user = await auth.getUser("user-claims-003");
        expect(user.customClaims).toEqual({});
    });

    it("role 변경 없으면 스킵 (불필요한 API 호출 방지)", async () => {
        await auth.createUser({ uid: "user-claims-004", email: "c4@example.com" });

        // 초기 설정
        await auth.setCustomUserClaims("user-claims-004", { role: "employee", orgId: "org-001" });

        // 같은 role/orgId로 호출 → 스킵
        await executeSetCustomClaims({
            uid: "user-claims-004",
            before: { role: "employee", organizationId: "org-001" },
            after: { role: "employee", organizationId: "org-001" },
        });

        // Claims가 변경되지 않음을 확인
        const user = await auth.getUser("user-claims-004");
        expect(user.customClaims).toEqual({ role: "employee", orgId: "org-001" });
    });

    it("Auth에 존재하지 않는 UID → 에러 없이 스킵", async () => {
        // Auth 계정 생성하지 않고 바로 호출
        await expect(
            executeSetCustomClaims({
                uid: "non-existent-uid",
                before: null,
                after: { role: "admin", organizationId: "org-001" },
            })
        ).resolves.toBeUndefined();
    });
});
