/**
 * joinOrganization 에뮬레이터 통합 테스트
 *
 * Firebase Auth + Firestore 에뮬레이터를 사용하여
 * 초대 코드 기반 기관 가입 로직을 실제 데이터로 검증한다.
 */
import {
    initializeTestApp,
    clearFirestoreData,
    clearAuthUsers,
    getTestFirestore,
} from "./emulator.setup";
import { getAuth } from "firebase-admin/auth";

// 에뮬레이터 setup 먼저 실행 (모듈 로딩 전에 환경변수 설정 필요)
initializeTestApp();

const db = getTestFirestore();
const auth = getAuth();

// joinOrganization 내부 로직을 직접 테스트하기 위해 핵심 로직을 함수로 추출
// (onCall 래퍼 없이 비즈니스 로직만 테스트)
async function executeJoinOrganization(params: {
    uid: string;
    email: string;
    displayName?: string;
    signInProvider?: string;
    code: string;
}) {
    const { uid, email, displayName = "", signInProvider = "google.com", code } = params;

    // 1. 인증 확인
    if (!uid) throw { code: "unauthenticated", message: "로그인이 필요합니다." };

    // 익명 사용자 차단
    if (signInProvider === "anonymous" || !email) {
        throw { code: "failed-precondition", message: "Google 계정으로 로그인 후 다시 시도해주세요." };
    }

    // 2. 파라미터 검증
    if (!code || code.length !== 6) {
        throw { code: "invalid-argument", message: "6자리 초대 코드를 입력해주세요." };
    }

    const upperCode = code.toUpperCase();

    // 3. 초대 코드로 기관 검색
    const orgSnap = await db
        .collection("organizations")
        .where("inviteCode", "==", upperCode)
        .where("status", "==", "approved")
        .limit(1)
        .get();

    if (orgSnap.empty) {
        throw { code: "not-found", message: "유효하지 않은 초대 코드입니다." };
    }

    const orgDoc = orgSnap.docs[0];
    const orgId = orgDoc.id;
    const orgData = orgDoc.data();

    // 4. 이미 가입된 사용자인지 확인
    const existingUser = await db.collection("users").doc(uid).get();
    if (existingUser.exists && existingUser.data()?.organizationId) {
        throw { code: "already-exists", message: "이미 기관에 소속되어 있습니다." };
    }

    // 5. 기존 멤버 목록에서 이메일 매칭
    const membersSnap = await db
        .collection("users")
        .where("organizationId", "==", orgId)
        .get();

    // 6. preRegistered 서브컬렉션에서 이메일 매칭
    let preRegName = "";
    let preRegDocId = "";
    const preRegSnap = await db
        .collection("organizations")
        .doc(orgId)
        .collection("preRegistered")
        .where("email", "==", email.toLowerCase())
        .get();

    if (!preRegSnap.empty) {
        const preRegDoc = preRegSnap.docs[0];
        preRegName = preRegDoc.data().name || "";
        preRegDocId = preRegDoc.id;
    }

    // 7. admin 존재 여부 확인
    const hasAdmin = membersSnap.docs.some((d) => d.data().role === "admin");
    const role = hasAdmin ? "employee" : "admin";

    // 8. 사용자 문서 생성
    const finalName = preRegName || displayName || "";
    await db.collection("users").doc(uid).set({
        email,
        name: finalName,
        role,
        organizationId: orgId,
        phone: "",
        createdAt: new Date(),
    });

    // Claims 설정
    await auth.setCustomUserClaims(uid, { role, orgId });

    // 9. preRegistered 삭제
    if (preRegDocId) {
        await db
            .collection("organizations")
            .doc(orgId)
            .collection("preRegistered")
            .doc(preRegDocId)
            .delete();
    }

    return { success: true, orgId, orgName: orgData.name || "", role };
}

describe("joinOrganization — 에뮬레이터 통합 테스트", () => {
    const TEST_ORG_ID = "test-org-001";
    const TEST_INVITE_CODE = "ABC123";

    beforeEach(async () => {
        await clearFirestoreData();
        await clearAuthUsers();

        // 테스트용 기관 문서 생성
        await db.collection("organizations").doc(TEST_ORG_ID).set({
            name: "테스트 복지관",
            inviteCode: TEST_INVITE_CODE,
            status: "approved",
            createdAt: new Date(),
        });
    });

    afterAll(async () => {
        await clearFirestoreData();
        await clearAuthUsers();
    });

    it("유효한 초대 코드로 가입 성공 — user 문서 생성 + Claims 설정", async () => {
        // Auth 에뮬레이터에 테스트 사용자 생성
        const testUser = await auth.createUser({
            uid: "user-001",
            email: "test@example.com",
            displayName: "홍길동",
        });

        const result = await executeJoinOrganization({
            uid: testUser.uid,
            email: "test@example.com",
            displayName: "홍길동",
            code: TEST_INVITE_CODE,
        });

        expect(result.success).toBe(true);
        expect(result.orgId).toBe(TEST_ORG_ID);
        expect(result.orgName).toBe("테스트 복지관");
        expect(result.role).toBe("admin"); // 첫 번째 가입자 → admin

        // Firestore user 문서 확인
        const userDoc = await db.collection("users").doc("user-001").get();
        expect(userDoc.exists).toBe(true);
        expect(userDoc.data()?.organizationId).toBe(TEST_ORG_ID);
        expect(userDoc.data()?.role).toBe("admin");
        expect(userDoc.data()?.email).toBe("test@example.com");

        // Auth Custom Claims 확인
        const claims = (await auth.getUser("user-001")).customClaims;
        expect(claims).toEqual({ role: "admin", orgId: TEST_ORG_ID });
    });

    it("유효하지 않은 초대 코드 → not-found 에러", async () => {
        await auth.createUser({ uid: "user-002", email: "test2@example.com" });

        await expect(
            executeJoinOrganization({
                uid: "user-002",
                email: "test2@example.com",
                code: "WRONG1",
            })
        ).rejects.toEqual(
            expect.objectContaining({ code: "not-found" })
        );
    });

    it("이미 기관 소속인 사용자 → already-exists 에러", async () => {
        await auth.createUser({ uid: "user-003", email: "test3@example.com" });

        // 이미 기관 소속으로 등록
        await db.collection("users").doc("user-003").set({
            email: "test3@example.com",
            organizationId: "other-org",
            role: "employee",
        });

        await expect(
            executeJoinOrganization({
                uid: "user-003",
                email: "test3@example.com",
                code: TEST_INVITE_CODE,
            })
        ).rejects.toEqual(
            expect.objectContaining({ code: "already-exists" })
        );
    });

    it("admin이 이미 있으면 role은 employee로 설정", async () => {
        // 기존 admin 사용자
        await auth.createUser({ uid: "admin-001", email: "admin@example.com" });
        await db.collection("users").doc("admin-001").set({
            email: "admin@example.com",
            organizationId: TEST_ORG_ID,
            role: "admin",
        });

        // 새 사용자
        await auth.createUser({ uid: "user-004", email: "test4@example.com" });

        const result = await executeJoinOrganization({
            uid: "user-004",
            email: "test4@example.com",
            code: TEST_INVITE_CODE,
        });

        expect(result.role).toBe("employee");

        const userDoc = await db.collection("users").doc("user-004").get();
        expect(userDoc.data()?.role).toBe("employee");
    });

    it("preRegistered 매칭 — 사전 등록된 이름 반영 + preRegistered 문서 삭제", async () => {
        // 사전 등록 문서 생성
        await db
            .collection("organizations")
            .doc(TEST_ORG_ID)
            .collection("preRegistered")
            .doc("pre-001")
            .set({
                email: "prereg@example.com",
                name: "김사전등록",
            });

        await auth.createUser({ uid: "user-005", email: "prereg@example.com" });

        const result = await executeJoinOrganization({
            uid: "user-005",
            email: "prereg@example.com",
            displayName: "구글이름",
            code: TEST_INVITE_CODE,
        });

        expect(result.success).toBe(true);

        // 사전 등록 이름이 우선 적용
        const userDoc = await db.collection("users").doc("user-005").get();
        expect(userDoc.data()?.name).toBe("김사전등록");

        // preRegistered 문서 삭제 확인
        const preRegDoc = await db
            .collection("organizations")
            .doc(TEST_ORG_ID)
            .collection("preRegistered")
            .doc("pre-001")
            .get();
        expect(preRegDoc.exists).toBe(false);
    });
});
