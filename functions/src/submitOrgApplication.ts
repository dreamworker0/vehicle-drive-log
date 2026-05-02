import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { v4 as uuidv4 } from "uuid";
import { log, wrapHandler } from "./helpers";
import { checkRateLimitByUid } from "./rateLimit";

interface SubmitApplicationPayload {
    orgName: string;
    applicantName: string;
    applicantEmail: string;
    applicantPhone: string;
    message: string;
    imageBase64: string; // Base64 인코딩된 이미지 문자열 (data:image/jpeg;base64, 부분 제외)
    imageMimeType: string; // 예: "image/jpeg", "application/pdf"
}

/**
 * submitOrgApplication
 * 기관 가입 신청서 및 비영리 증빙서류 업로드 (익명 로그인 대체용)
 * 미가입 사용자가 호출하므로 request.auth 검사를 생략하지만,
 * applicantEmail 기반으로 Rate Limit을 적용하여 스팸을 방지한다.
 */
export const submitOrgApplication = onCall(
    {
        region: "asia-northeast3",
        memory: "512MiB",
        timeoutSeconds: 60,
        enforceAppCheck: false,
    },
    wrapHandler("submitOrgApplication", async (request: CallableRequest<Partial<SubmitApplicationPayload>>) => {
        const payload = request.data;

        // 1. 필수 값 검증
        if (!payload.orgName || !payload.applicantName || !payload.applicantEmail || !payload.applicantPhone) {
            throw new HttpsError("invalid-argument", "필수 입력 항목이 누락되었습니다.");
        }
        if (!payload.imageBase64 || !payload.imageMimeType) {
            throw new HttpsError("invalid-argument", "증빙서류 이미지 데이터가 누락되었습니다.");
        }

        const email = payload.applicantEmail.trim().toLowerCase();

        // 2. Rate Limit 검사: 동일 이메일로 1시간에 3회 이상 신청 불가 (무단 반복 요청 방지)
        // checkRateLimitByUid는 원래 uid 기반이지만, 이메일을 uid처럼 활용하여 제한
        await checkRateLimitByUid("submitOrgApplication", email, 3, 3600);

        try {
            const db = getFirestore();
            const storage = getStorage();
            const bucket = storage.bucket(); // 기본 버킷

            // 3. 새 기관 문서 ID 생성 (사전 발급)
            const orgRef = db.collection("organizations").doc();
            const orgId = orgRef.id;

            // 4. Base64 이미지 디코딩 및 Storage 업로드
            let fileBuffer: Buffer;
            try {
                // data: URI prefix가 섞여 왔을 경우를 대비한 안전 제거 정규식
                const base64Data = payload.imageBase64.replace(/^data:([A-Za-z-+/]+);base64,/, '');
                fileBuffer = Buffer.from(base64Data, "base64");
            } catch (bufferErr) {
                log("ERROR", "submitOrgApplication", "이미지 디코딩 실패", { email, error: (bufferErr as Error).message });
                throw new HttpsError("invalid-argument", "잘못된 이미지 형식입니다.");
            }

            // 파일 용량 초과 검증 (5MB 제한)
            if (fileBuffer.byteLength > 5 * 1024 * 1024) {
                throw new HttpsError("out-of-range", "파일 크기는 5MB를 초과할 수 없습니다.");
            }

            const isPdf = payload.imageMimeType === "application/pdf";
            const ext = isPdf ? "pdf" : "jpg";
            const filePath = `organizations/${orgId}/uniqueNumberImage.${ext}`;
            const file = bucket.file(filePath);

            log("INFO", "submitOrgApplication", "Uploading image", { email, orgId, size: fileBuffer.byteLength });

            // Firebase Storage Read를 위한 임시 다운로드 토큰 생성 (Client SDK URL과 동일한 형식)
            const token = uuidv4();
            await file.save(fileBuffer, {
                metadata: {
                    contentType: payload.imageMimeType,
                    metadata: {
                        firebaseStorageDownloadTokens: token,
                    },
                },
            });

            // Firebase Storage Download URL 생성
            const bucketName = bucket.name;
            const uniqueNumberImageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;

            // 5. Firestore 문서 생성
            const now = FieldValue.serverTimestamp();
            await orgRef.set({
                name: payload.orgName.trim(),
                applicantName: payload.applicantName.trim(),
                applicantEmail: email,
                applicantPhone: payload.applicantPhone.trim(),
                applicantUid: "anonymous-app", // 익명 로그인 대체 플래그
                message: payload.message ? payload.message.trim() : "",
                status: "pending",
                aiVerified: false,
                uniqueNumberImageUrl,
                createdAt: now,
                updatedAt: now,
            });

            log("INFO", "submitOrgApplication", "신청 완료", { orgId, email });

            return {
                success: true,
                orgId,
                uniqueNumberImageUrl,
            };
        } catch (err: unknown) {
            log("ERROR", "submitOrgApplication", "업로드 또는 저장 처리 중 시스템 오류", {
                email,
                error: (err as Error).message,
                stack: (err as Error).stack,
            });
            throw new HttpsError("internal", "신청을 처리하는 중에 시스템 오류가 발생했습니다.");
        }
    })
);
