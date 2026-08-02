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
import { writeAuditEntry } from "../../services/audit/writeAuditEntry";
import { log } from "../../utils/helpers";

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

// 4차 배치(2026-07-25): 사업자등록증·고유번호증 서명 URL을 내주는 경로라 민감도가 높고,
// 같은 심사 화면의 ocrDocument는 이미 강제 중이라 정책이 갈려 있었다(3차 리뷰 M2).
// 호출부는 superAdmin 심사 화면(OrgDocumentViewer → fetchOrgDocumentUrl)뿐이다.
export const getOrgDocumentUrl = onCall(
    {
        region: "asia-northeast3",
        enforceAppCheck: true,
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

        // 접속기록 — superAdmin이 타 기관의 증빙서류(대표자명·기관 정보 포함)를 연 사실을 남긴다.
        // 이 경로는 서버 콜러블이라 **클라이언트가 건너뛸 수 없다**. 엑셀·PDF 반출은
        // 브라우저에서 만들어져 우회가 가능한 것과 대조된다(recordExport 주석 참고).
        //
        // 서명 URL 발급 **후에** 기록한다. 앞에 두면 권한·경로 검증에서 걸러질 요청까지
        // 기록되고, 기록 실패가 정상 심사를 막는다. 기록 실패는 삼킨다 — 심사 화면이
        // 감사 쓰기 때문에 멈추면 안 된다(단, ERROR 로그로 Sentry에는 남는다).
        //
        // 문서 ID에 발급 시각(분)을 넣어 연속 조회가 로그를 채우지 않게 하되,
        // 시간대별 접근 사실은 보존한다.
        const minuteBucket = new Date(Date.now()).toISOString().slice(0, 16).replace(/[:-]/g, "");
        try {
            await writeAuditEntry({
                docId: `orgdoc_${request.auth.uid}_${orgId}_${minuteBucket}`,
                // 심사 대상 기관 기준으로 남긴다 — 그 기관에 대한 접근 사실이기 때문이다.
                organizationId: orgId,
                action: "read",
                targetType: "orgDocument",
                targetId: orgId,
                actorUid: request.auth.uid,
                // 증빙서류의 정보주체는 기관 대표자·담당자로 uid가 없다. 이름을 넣으면
                // 감사 로그가 이름을 담게 되므로 비운다(Phase 123의 탑승자 판단과 같다).
                subjectUids: [],
            });
        } catch (err) {
            log("ERROR", "getOrgDocumentUrl", "증빙서류 열람 기록 실패", {
                uid: request.auth.uid, orgId, error: (err as Error).message,
            });
        }

        return { url };
    }
);
