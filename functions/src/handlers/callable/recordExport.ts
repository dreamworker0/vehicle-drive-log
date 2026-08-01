/**
 * recordExport — 개인정보 반출(내보내기) 기록 (onCall)
 *
 * 근거: 고시 제16조. Phase 123은 **전면 열람 로그를 하지 않기로** 결정했다 —
 * 로그가 원본보다 커지고, 실질 위험은 개별 조회가 아니라 **반출**에 있기 때문이다.
 * 화면에서 한 건을 여는 것과 운행일지 5,000건을 엑셀로 받아 나가는 것은 다른 행위다.
 *
 * ## 무엇을 남기고 무엇을 남기지 않는가
 * 형식(엑셀/PDF)·대상(운행일지/주유/정비…)·건수만 남긴다. **반출된 데이터의 내용은
 * 절대 담지 않는다** — 담는 순간 감사 로그가 개인정보 사본이 되어 그 로그도 보호
 * 대상이 되는 순환에 빠진다(변경 로그가 값 대신 필드명만 남기는 것과 같은 원칙).
 * 기간·필터 조건도 남기지 않는다. 목적지·이름이 검색어에 들어갈 수 있어서다.
 *
 * ## 한계 — 클라이언트가 부르지 않으면 남지 않는다
 * 엑셀·PDF는 브라우저에서 만들어지므로 서버가 개입하는 지점이 없다. 우회를 막으려면
 * 내보내기 자체를 서버에서 생성해야 하는데, 그러면 5,000건 문서를 Functions 메모리로
 * 올려야 해 비용·타임아웃 위험이 크다. 지금은 정직하게 한계를 적어 둔다.
 * (superAdmin의 타 기관 증빙서류 열람은 서버 콜러블이라 우회 불가하게 기록된다.)
 */
import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { log, wrapHandler } from "../../utils/helpers";
import { checkRateLimitByUid } from "../../utils/rateLimit";
import { writeAuditEntry, resolveOrgId } from "../../services/audit/writeAuditEntry";

/** 반출 형식 — 화면에서 실제로 만들 수 있는 것만 허용한다 */
const FORMATS = new Set(["excel", "pdf"]);

/**
 * 반출 대상 데이터셋.
 * 자유 문자열을 받으면 클라이언트가 임의 값을 넣어 로그를 오염시킬 수 있다
 * (Phase 123이 화이트리스트로 뒤집으며 막았던 것과 같은 경로).
 */
const DATASETS = new Set([
    "driveLogs",        // 운행일지 — 운전자·공동운전자·탑승자 이름 포함
    "dailyLogs",        // 일별 운행일지
    "fuelLogs",         // 주유 기록
    "hipassCharges",    // 하이패스 충전
    "maintenance",      // 정비 기록
]);

interface RecordExportPayload {
    format: string;
    dataset: string;
    recordCount: number;
    /** 같은 반출의 재시도가 중복을 만들지 않도록 클라이언트가 만드는 난수 */
    exportId: string;
}

const EXPORT_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export const recordExport = onCall(
    {
        region: "asia-northeast3",
        enforceAppCheck: true,
    },
    wrapHandler("recordExport", async (request: CallableRequest<Partial<RecordExportPayload>>) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }
        const uid = request.auth.uid;
        const payload = request.data || {};

        if (typeof payload.format !== "string" || !FORMATS.has(payload.format)) {
            throw new HttpsError("invalid-argument", "반출 형식이 올바르지 않습니다.");
        }
        if (typeof payload.dataset !== "string" || !DATASETS.has(payload.dataset)) {
            throw new HttpsError("invalid-argument", "반출 대상이 올바르지 않습니다.");
        }
        if (typeof payload.recordCount !== "number" || !Number.isInteger(payload.recordCount) || payload.recordCount < 0) {
            throw new HttpsError("invalid-argument", "반출 건수가 올바르지 않습니다.");
        }
        if (typeof payload.exportId !== "string" || !EXPORT_ID_PATTERN.test(payload.exportId)) {
            throw new HttpsError("invalid-argument", "반출 식별자가 올바르지 않습니다.");
        }

        // 내보내기는 사람이 버튼을 눌러야 일어난다. 한도는 자동화된 대량 반출 탐지용이다.
        await checkRateLimitByUid("recordExport", uid, 60, 3600);

        const organizationId = await resolveOrgId(uid);

        await writeAuditEntry({
            docId: `export_${uid}_${payload.exportId}`,
            organizationId,
            action: "export",
            targetType: "export",
            targetId: payload.dataset,
            actorUid: uid,
            // 반출은 대상 정보주체가 특정되지 않는다(수백 건이 한 번에 나간다).
            // 억지로 채우면 로그가 uid 목록을 담게 되어 최소수집에 반한다.
            subjectUids: [],
            exportFormat: payload.format,
            exportDataset: payload.dataset,
            recordCount: payload.recordCount,
        });

        log("INFO", "recordExport", "반출 기록", {
            uid, organizationId, dataset: payload.dataset,
            format: payload.format, recordCount: payload.recordCount,
        });

        return { success: true };
    })
);
