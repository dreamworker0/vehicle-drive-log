/**
 * autoVerifyDocument — 기관 신청 자동 검증 (OCR + AI 분석 + 이메일)
 */
import { onDocumentUpdated } from "firebase-functions/firestore";
import { GoogleGenAI } from "@google/genai";
import { defineString } from "firebase-functions/params";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import * as emailjs from "@emailjs/nodejs";
import * as nodemailer from "nodemailer";

const geminiApiKey = defineString("GEMINI_API_KEY");
const tmapApiKey = defineString("TMAP_API_KEY");

/**
 * 사업자번호 중간 2자리 + 키워드 기반 비영리 판별 보조 함수
 */
function classifyByBizNumber(bizNumber: string | null, orgName: string | null, documentType: string): { score: number; result?: string } {
    let score = 0;

    if (documentType === "고유번호증") {
        return { score: 100, result: "비영리 확정" };
    }

    if (bizNumber) {
        const bizMatch = bizNumber.match(/\d{3}-(\d{2})-\d{5}/);
        const mid = bizMatch ? bizMatch[1] : null;

        if (mid === "82") score += 40;
        else if (mid === "81") score -= 40;
        else if (mid === "80") score -= 30;
    }

    const name = (orgName || "").toLowerCase();
    if (name.includes("사단법인")) score += 30;
    if (name.includes("재단법인")) score += 30;
    if (name.includes("사회복지")) score += 40;
    if (name.includes("비영리")) score += 30;
    if (name.includes("복지관")) score += 20;
    if (name.includes("복지센터")) score += 20;
    if (name.includes("주식회사") || name.includes("(주)")) score -= 50;
    if (name.includes("유한회사") || name.includes("유한책임")) score -= 40;

    return { score };
}

/**
 * Firebase Storage download URL에서 파일을 다운로드하여 base64로 변환
 */
async function downloadFileAsBase64(downloadUrl: string): Promise<{ base64: string; mimeType: string }> {
    const storage = getStorage();
    const pathMatch = downloadUrl.match(/\/o\/(.+?)\?/);
    if (!pathMatch) {
        throw new Error("유효하지 않은 Storage URL입니다: " + downloadUrl);
    }
    const filePath = decodeURIComponent(pathMatch[1]);
    const isPdf = filePath.toLowerCase().endsWith(".pdf");
    const mimeType = isPdf ? "application/pdf" : "image/jpeg";

    const [buffer] = await storage.bucket().file(filePath).download();
    return {
        base64: buffer.toString("base64"),
        mimeType,
    };
}

/**
 * Tmap POI 검색으로 주소 찾기 (OCR 주소 추출 실패 시 폴백)
 */
async function searchAddressByTmap(keyword: string, apiKey: string): Promise<string | null> {
    if (!keyword?.trim() || !apiKey) return null;

    const url = `https://apis.openapi.sk.com/tmap/pois?version=1&format=json&searchKeyword=${encodeURIComponent(keyword)}&resCoordType=WGS84GEO&reqCoordType=WGS84GEO&count=1`;
    const response = await fetch(url, { headers: { appKey: apiKey } });
    const data: any = await response.json();

    const poi = data?.searchPoiInfo?.pois?.poi?.[0];
    if (!poi) return null;

    const newAddr = poi.newAddressList?.newAddress?.[0];
    if (newAddr) {
        const parts = [newAddr.fullAddressRoad].filter(Boolean);
        if (parts.length > 0) return parts.join(" ");
    }

    const parts = [poi.upperAddrName, poi.middleAddrName, poi.lowerAddrName, poi.detailAddrName].filter(Boolean);
    return parts.length > 0 ? parts.join(" ") : null;
}

// EmailJS 설정
const EMAILJS_PUBLIC_KEY = "2G7A7gudLQ01I4hJW";
const EMAILJS_PRIVATE_KEY = defineString("EMAILJS_PRIVATE_KEY");
const EMAILJS_SERVICE_ID = "service_p4hpecv";
const EMAILJS_TEMPLATE_ID = "template_qmfktgb";
const SERVICE_URL = "https://vehicle-drive-log.web.app";

/**
 * 승인 이메일 발송 (서버 사이드)
 */
async function sendApprovalEmailServer(recipientEmail: string, orgName: string, inviteCode: string): Promise<boolean> {
    try {
        const response = await emailjs.send(
            EMAILJS_SERVICE_ID,
            EMAILJS_TEMPLATE_ID,
            {
                to_email: recipientEmail,
                to_name: orgName,
                name: orgName,
                org_name: orgName,
                invite_code: inviteCode,
                service_url: SERVICE_URL,
            },
            {
                publicKey: EMAILJS_PUBLIC_KEY,
                privateKey: EMAILJS_PRIVATE_KEY.value(),
            }
        );
        console.log(`[AutoVerify] 📧 승인 이메일 발송 성공: ${recipientEmail}`, response.status, response.text);
        return true;
    } catch (err: unknown) {
        console.error(`[AutoVerify] ❌ 승인 이메일 발송 실패: ${recipientEmail}`, err);
        return false;
    }
}

/**
 * 거부 이메일 발송 (Nodemailer — Gmail SMTP)
 */
async function sendRejectionEmail(recipientEmail: string, orgName: string, reason: string): Promise<boolean> {
    try {
        const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
                user: process.env.GMAIL_USER,
                pass: process.env.GMAIL_APP_PASSWORD,
            },
        });

        const mailOptions = {
            from: `"차량운행일지 시스템" <${process.env.GMAIL_USER}>`,
            to: recipientEmail,
            subject: `[차량운행일지] 기관 신청 결과 안내: ${orgName}`,
            html: `
                <div style="font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="background: linear-gradient(135deg, #EF4444, #DC2626); color: white; padding: 24px; border-radius: 12px 12px 0 0;">
                        <h2 style="margin: 0; font-size: 20px;">기관 신청이 승인되지 않았습니다</h2>
                    </div>
                    <div style="background: #F8FAFC; padding: 24px; border: 1px solid #E2E8F0; border-top: none; border-radius: 0 0 12px 12px;">
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr>
                                <td style="padding: 12px 0; border-bottom: 1px solid #E2E8F0; color: #64748B; width: 100px;">기관명</td>
                                <td style="padding: 12px 0; border-bottom: 1px solid #E2E8F0; font-weight: 600; color: #1E293B;">${orgName}</td>
                            </tr>
                            <tr>
                                <td style="padding: 12px 0; color: #64748B;">거부 사유</td>
                                <td style="padding: 12px 0; color: #DC2626; font-weight: 600;">${reason}</td>
                            </tr>
                        </table>
                        <div style="margin-top: 20px; padding: 16px; background: #FEF2F2; border-radius: 8px; border: 1px solid #FECACA;">
                            <p style="margin: 0; color: #991B1B; font-size: 14px;">
                                문의사항이 있으시면 관리자에게 연락해 주세요.
                            </p>
                        </div>
                    </div>
                    <p style="text-align: center; color: #94A3B8; font-size: 12px; margin-top: 16px;">
                        이 메일은 차량운행일지 시스템에서 자동 발송되었습니다.
                    </p>
                </div>
            `,
        };

        await transporter.sendMail(mailOptions);
        console.log(`[AutoVerify] 📧 거부 이메일 발송 성공: ${recipientEmail}`);
        return true;
    } catch (err: unknown) {
        console.error(`[AutoVerify] ❌ 거부 이메일 발송 실패: ${recipientEmail}`, (err as Error).message);
        return false;
    }
}

/**
 * Firestore Trigger — organization 문서에 uniqueNumberImageUrl이 추가되면 자동 OCR 실행
 */
export const autoVerifyDocument = onDocumentUpdated(
    {
        document: "organizations/{orgId}",
        region: "asia-northeast3",
        timeoutSeconds: 120,
        memory: "512MiB",
    },
    async (event) => {
        const before = event.data!.before.data();
        const after = event.data!.after.data();
        const orgId = event.params.orgId;

        if (!after.uniqueNumberImageUrl) return;
        if (before.uniqueNumberImageUrl === after.uniqueNumberImageUrl) return;
        if (after.aiVerifyDetail) return;

        const orgName = after.name as string;
        const imageUrl = after.uniqueNumberImageUrl as string;
        const applicantEmail = after.applicantEmail as string | undefined;

        console.log(`[AutoVerify] 기관 ${orgName} (${orgId}) AI 분석 시작`);

        try {
            const ai = new GoogleGenAI({ apiKey: geminiApiKey.value() });

            const prompt = `이 문서 이미지를 분석해주세요. 이 문서는 한국의 공문서입니다.

다음 정보를 추출하고 판단해주세요:

1. "documentType": 문서 유형을 판별해주세요. 다음 중 하나:
   - "고유번호증" — 비영리법인/단체의 고유번호증
   - "사업자등록증(비영리)" — 비영리법인/단체의 사업자등록증 (법인 종류가 비영리사단법인, 비영리재단법인, 사회복지법인, 비영리민간단체 등에 해당)
   - "사업자등록증(영리)" — 영리 목적의 일반 기업 사업자등록증 (주식회사, 유한회사, 개인사업자 등)
   - "기타" — 위에 해당하지 않는 경우

   판별 팁: 사업자등록증에서 '법인명(단체명)', '법인등록번호', '종목', '업태' 등을 확인하세요.
   비영리법인은 보통 법인 종류에 '비영리', '사회복지', '재단법인', '사단법인' 등이 포함됩니다.

2. "uniqueNumber": 고유번호(또는 사업자등록번호) 추출 (예: "123-82-12345")

3. "extractedName": 문서에 기재된 단체명(기관명, 법인명, 상호) 추출

4. "address": 문서에 기재된 소재지(주소) 추출

5. "nameMatch": 입력된 기관명 "${orgName}"과 추출된 단체명이 의미상 일치하는지 판단 (true/false)
   - 약칭이나 부분 포함도 일치로 판단 (예: "행복복지관" ↔ "사회복지법인 행복복지관" → true)

반드시 아래 JSON 형식으로만 응답해주세요:
{
  "documentType": "고유번호증 또는 사업자등록증(비영리) 또는 사업자등록증(영리) 또는 기타",
  "uniqueNumber": "추출된 번호",
  "extractedName": "추출된 단체명",
  "address": "추출된 주소",
  "nameMatch": true 또는 false
}

값을 확인할 수 없는 경우 null로 표시해주세요.`;

            const fileInfo = await downloadFileAsBase64(imageUrl);

            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: [
                    {
                        role: "user",
                        parts: [
                            {
                                inlineData: {
                                    data: fileInfo.base64,
                                    mimeType: fileInfo.mimeType,
                                },
                            },
                            { text: prompt },
                        ],
                    },
                ],
            });

            const text = (response.text ?? "").trim();

            // JSON 파싱
            const result: {
                documentType: string;
                uniqueNumber: string | null;
                extractedName: string | null;
                nameMatch: boolean;
                address: string | null;
            } = {
                documentType: "기타",
                uniqueNumber: null,
                extractedName: null,
                nameMatch: false,
                address: null,
            };

            try {
                const jsonMatch = text.match(/\{[\s\S]*?\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    result.documentType = parsed.documentType || "기타";
                    result.uniqueNumber = parsed.uniqueNumber || null;
                    result.extractedName = parsed.extractedName || null;
                    result.nameMatch = parsed.nameMatch === true;
                    result.address = parsed.address || null;
                }
            } catch (parseErr) {
                console.warn("[AutoVerify] JSON 파싱 실패:", parseErr);
            }

            // OCR이 주소를 추출하지 못한 경우 Tmap POI 검색으로 폴백
            if (!result.address && orgName) {
                try {
                    const tmapAddress = await searchAddressByTmap(orgName, tmapApiKey.value());
                    if (tmapAddress) {
                        result.address = tmapAddress;
                        console.log(`[AutoVerify] Tmap 주소 폴백 성공: ${tmapAddress}`);
                    } else {
                        console.log(`[AutoVerify] Tmap 주소 폴백: 검색 결과 없음 (${orgName})`);
                    }
                } catch (tmapErr: unknown) {
                    console.warn("[AutoVerify] Tmap 주소 폴백 실패:", (tmapErr as Error).message);
                }
            }

            const bizScore = classifyByBizNumber(result.uniqueNumber, result.extractedName, result.documentType);

            let finalDocType = result.documentType;
            if (finalDocType === "기타" && bizScore.score >= 50) {
                finalDocType = "사업자등록증(비영리)";
            }
            if (finalDocType === "사업자등록증(비영리)" && bizScore.score <= -30) {
                finalDocType = "사업자등록증(영리)";
            }

            const isForProfit = finalDocType === "사업자등록증(영리)";
            const isNonProfit = finalDocType === "고유번호증" || finalDocType === "사업자등록증(비영리)";
            const aiVerified = isNonProfit && result.nameMatch === true && result.uniqueNumber != null;

            // Firestore 업데이트
            const db = getFirestore();
            const updateData: Record<string, unknown> = {
                aiVerified,
                aiVerifyDetail: {
                    documentType: finalDocType,
                    uniqueNumber: result.uniqueNumber,
                    extractedName: result.extractedName,
                    nameMatch: result.nameMatch,
                    address: result.address,
                    bizScore: bizScore.score,
                } as Record<string, unknown>,
                uniqueNumber: result.uniqueNumber || "",
                address: result.address || "",
            };

            // 영리 사업자등록증이면 자동 거부
            if (isForProfit) {
                updateData.status = "rejected";
                updateData.rejectedAt = new Date();
                (updateData.aiVerifyDetail as Record<string, unknown>).rejected = true;
                (updateData.aiVerifyDetail as Record<string, unknown>).reason =
                    "영리 목적의 사업자등록증이 제출되었습니다. 본 서비스는 비영리단체 전용입니다.";

                if (applicantEmail) {
                    await sendRejectionEmail(
                        applicantEmail,
                        orgName,
                        (updateData.aiVerifyDetail as Record<string, unknown>).reason as string
                    );
                }
            }

            // 고유번호 중복 체크
            if (result.uniqueNumber && !isForProfit) {
                const duplicateSnapshot = await db.collection("organizations")
                    .where("uniqueNumber", "==", result.uniqueNumber)
                    .where("status", "in", ["pending", "approved"])
                    .get();

                const realDuplicates = duplicateSnapshot.docs.filter((d) => d.id !== orgId);
                if (realDuplicates.length > 0) {
                    const existingOrg = realDuplicates[0].data();
                    const existingStatus = existingOrg.status === "approved" ? "승인된" : "대기 중인";
                    updateData.status = "rejected";
                    updateData.rejectedAt = new Date();
                    updateData.aiVerified = false;
                    (updateData.aiVerifyDetail as Record<string, unknown>).rejected = true;
                    (updateData.aiVerifyDetail as Record<string, unknown>).reason =
                        `동일한 고유번호(${result.uniqueNumber})로 이미 ${existingStatus} 기관이 있습니다.`;

                    console.log(
                        `[AutoVerify] 기관 ${orgName} (${orgId}) 중복 고유번호 거절: ${result.uniqueNumber} (기존 기관: ${existingOrg.name})`
                    );

                    if (applicantEmail) {
                        await sendRejectionEmail(
                            applicantEmail,
                            orgName,
                            (updateData.aiVerifyDetail as Record<string, unknown>).reason as string
                        );
                    }
                }
            }

            // AI 검증 통과 시 자동 승인
            if (aiVerified && updateData.status !== "rejected") {
                const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
                updateData.status = "approved";
                updateData.approvedAt = new Date();
                updateData.inviteCode = inviteCode;

                console.log(`[AutoVerify] 기관 ${orgName} (${orgId}) AI 자동 승인! 초대코드: ${inviteCode}`);

                if (applicantEmail) {
                    await sendApprovalEmailServer(applicantEmail, orgName, inviteCode);
                } else {
                    console.warn(`[AutoVerify] 신청자 이메일 없음, 이메일 발송 스킵`);
                }
            }

            await db.doc(`organizations/${orgId}`).update(updateData);

            console.log(
                `[AutoVerify] 기관 ${orgName} (${orgId}) AI 분석 완료:`,
                aiVerified ? "승인 추천" : "거절 추천"
            );
        } catch (error: unknown) {
            console.error(`[AutoVerify] 기관 ${orgName} (${orgId}) AI 분석 실패:`, error);
        }
    }
);
