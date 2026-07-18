/**
 * getOrgDocumentUrl — 기관 증빙서류(고유번호증 등)의 단기 서명 URL 발급
 *
 * 증빙서류는 영구 다운로드 토큰 없이 저장되므로(2026-07-18 보안 재검증 P0-3),
 * 심사 화면에서 문서를 표시할 때 이 콜러블이 superAdmin에게만 5분 만료 서명 URL을 발급한다.
 * 접근 통제는 여기(역할 검증)와 Storage 보안 규칙으로 이원화된다.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

/** 서명 URL 만료(ms) — 심사 화면 표시에 충분한 최소치 */
const SIGNED_URL_TTL_MS = 5 * 60 * 1000;

/**
 * 신뢰 경계 밖 경로 조작 차단 — 해당 기관 폴더 하위의 단일 파일만 허용한다.
 */
function assertSafeOrgPath(filePath: string, orgId: string): void {
    if (
        !filePath ||
        filePath.includes("..") ||
        filePath.includes("\\") ||
        filePath.startsWith("/") ||
        !filePath.startsWith(`organizations/${orgId}/`)
    ) {
        throw new HttpsError("failed-precondition", "유효하지 않은 문서 경로입니다.");
    }
}

export const getOrgDocumentUrl = onCall(
    {
        region: "asia-northeast3",
        enforceAppCheck: false,
    },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }
        // 증빙서류는 심사자(superAdmin)만 열람한다.
        if (request.auth.token.role !== "superAdmin") {
            throw new HttpsError("permission-denied", "시스템 관리자만 사용할 수 있습니다.");
        }

        const { orgId } = (request.data ?? {}) as { orgId?: string };
        if (!orgId || typeof orgId !== "string" || orgId.includes("/") || orgId.includes("..")) {
            throw new HttpsError("invalid-argument", "유효한 기관 ID가 필요합니다.");
        }

        const db = getFirestore();
        const orgDoc = await db.collection("organizations").doc(orgId).get();
        if (!orgDoc.exists) {
            throw new HttpsError("not-found", "기관을 찾을 수 없습니다.");
        }
        const data = orgDoc.data() ?? {};

        // 신규 문서는 경로(uniqueNumberImagePath)를 저장한다.
        // 레거시 문서는 토큰 URL(uniqueNumberImageUrl)만 있으므로 경로를 역추출한다.
        let filePath = data.uniqueNumberImagePath as string | undefined;
        if (!filePath) {
            const legacyUrl = data.uniqueNumberImageUrl as string | undefined;
            // 쿼리스트링/프래그먼트 전까지 매칭 — 쿼리 파라미터가 없어도 견고하게 동작한다.
            const match = legacyUrl?.match(/\/o\/([^?#]+)/);
            if (match) {
                filePath = decodeURIComponent(match[1]);
            }
        }
        if (!filePath) {
            throw new HttpsError("not-found", "증빙서류가 없습니다.");
        }
        assertSafeOrgPath(filePath, orgId);

        const file = getStorage().bucket().file(filePath);
        const [exists] = await file.exists();
        if (!exists) {
            throw new HttpsError("not-found", "증빙서류 파일이 존재하지 않습니다.");
        }

        const [url] = await file.getSignedUrl({
            action: "read",
            expires: Date.now() + SIGNED_URL_TTL_MS,
        });

        return { url };
    }
);
