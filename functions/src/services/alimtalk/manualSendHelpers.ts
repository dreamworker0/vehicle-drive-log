/**
 * manualSendHelpers — 수동 알림톡 발송(승인/반려) 공통 로직
 *
 * sendManualApprovalAlimtalk / sendManualRejectionAlimtalk 쌍에서
 * orgId 검증 → 기관 문서 로드 → 수신자 필드 추출이 동일하게 반복되던 것을 공통화.
 */
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

export interface ManualAlimtalkOrg {
    /** 기관 문서 원본 데이터 */
    org: FirebaseFirestore.DocumentData;
    /** 신청자 전화번호 — 없으면 null (호출부에서 발송 생략 처리) */
    phone: string | null;
    /** 수신자 표시 이름 (신청자명 → 기관명 폴백) */
    name: string;
    /** 기관명 */
    orgName: string;
}

/** 수동 알림톡 발송용 기관 로드 — orgId 검증, 문서 존재 확인, 수신자 필드 추출 */
export async function loadOrgForManualAlimtalk(orgId: string | undefined): Promise<ManualAlimtalkOrg> {
    if (!orgId) {
        throw new HttpsError("invalid-argument", "orgId가 필요합니다.");
    }

    const db = getFirestore();
    const orgDoc = await db.doc(`organizations/${orgId}`).get();
    if (!orgDoc.exists) {
        throw new HttpsError("not-found", "기관을 찾을 수 없습니다.");
    }

    const org = orgDoc.data()!;
    return {
        org,
        phone: (org.applicantPhone as string | undefined) || null,
        name: (org.applicantName as string | undefined) || (org.name as string),
        orgName: org.name as string,
    };
}
