/**
 * verifyHelpers — 기관 자동 검증 공통 유틸리티
 *
 * autoVerifyDocument.ts에서 분리된 헬퍼 함수 및 이메일 발송 로직.
 */
import { getStorage } from "firebase-admin/storage";
import * as emailjs from "@emailjs/nodejs";
import { defineString } from "firebase-functions/params";
import { createGmailTransporter, systemMailFrom } from "../../core/mailer";

// ── 마스킹 유틸리티 ──

/**
 * 이름 마스킹 (가운데 글자 → *)
 * 예: "김종원" → "김*원", "홍길동" → "홍*동", "김수" → "김*"
 */
export function maskName(name: string | null | undefined): string {
    if (!name || name.length === 0) return "알 수 없음";
    if (name.length === 1) return name;
    if (name.length === 2) return name[0] + "*";
    const first = name[0];
    const last = name[name.length - 1];
    const middle = "*".repeat(name.length - 2);
    return first + middle + last;
}

/**
 * 이메일 마스킹 (앞 2글자만 표시, 나머지 ***)
 * 예: "example@email.com" → "ex***@email.com"
 */
export function maskEmail(email: string | null | undefined): string {
    if (!email || !email.includes("@")) return "알 수 없음";
    const [local, domain] = email.split("@");
    if (local.length <= 2) return local + "***@" + domain;
    return local.substring(0, 2) + "***@" + domain;
}

// ── 비영리 판별 ──

/**
 * 사업자번호 중간 2자리 + 키워드 기반 비영리 판별
 */
export function classifyByBizNumber(bizNumber: string | null, orgName: string | null, documentType: string): { score: number; result?: string } {
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
    if (name.includes("사회적협동조합")) score += 40;
    else if (name.includes("협동조합")) score += 20;
    if (name.includes("주식회사") || name.includes("(주)")) score -= 50;
    if (name.includes("유한회사") || name.includes("유한책임")) score -= 40;

    return { score };
}

// ── 파일 유틸리티 ──

/**
 * Firebase Storage download URL에서 파일을 다운로드하여 base64로 변환
 *
 * Admin SDK 다운로드는 URL의 토큰을 무시하고 경로만 사용하므로, 호출자가 URL을 조작해
 * 타 기관 파일을 읽을 수 있다. expectedPathPrefix로 허용 경로를 강제한다 (2026-07-10 감사 #3).
 */
export async function downloadFileAsBase64(downloadUrl: string, expectedPathPrefix?: string): Promise<{ base64: string; mimeType: string }> {
    const storage = getStorage();
    const pathMatch = downloadUrl.match(/\/o\/(.+?)\?/);
    if (!pathMatch) {
        throw new Error("유효하지 않은 Storage URL입니다: " + downloadUrl);
    }
    const filePath = decodeURIComponent(pathMatch[1]);
    // 경로 조작(상대경로·역슬래시·선행 슬래시) 및 허용 범위 밖 접근 차단
    if (filePath.includes("..") || filePath.includes("\\") || filePath.startsWith("/")) {
        throw new Error("유효하지 않은 파일 경로입니다: " + filePath);
    }
    if (expectedPathPrefix && !filePath.startsWith(expectedPathPrefix)) {
        throw new Error(`허용 범위를 벗어난 Storage 경로입니다: ${filePath} (기대 prefix: ${expectedPathPrefix})`);
    }
    const isPdf = filePath.toLowerCase().endsWith(".pdf");
    const mimeType = isPdf ? "application/pdf" : "image/jpeg";

    const [buffer] = await storage.bucket().file(filePath).download();
    return { base64: buffer.toString("base64"), mimeType };
}

// ── 지오코딩 ──

// Tmap POI/Geocoding API 응답의 사용 필드만 정의한 최소 타입
interface TmapPoi {
    noorLat: string;
    noorLon: string;
    newAddressList?: { newAddress?: Array<{ fullAddressRoad?: string }> };
    upperAddrName?: string;
    middleAddrName?: string;
    lowerAddrName?: string;
    detailAddrName?: string;
}
interface TmapPoiResponse {
    searchPoiInfo?: { pois?: { poi?: TmapPoi[] } };
}
interface TmapGeoResponse {
    coordinateInfo?: { coordinate?: Array<{ newLat: string; lat: string; newLon: string; lon: string }> };
}

/**
 * Tmap POI 검색으로 주소 + 좌표 찾기
 */
export async function searchAddressByTmap(keyword: string, apiKey: string): Promise<{ address: string; lat: number; lng: number } | null> {
    if (!keyword?.trim() || !apiKey) return null;

    const url = `https://apis.openapi.sk.com/tmap/pois?version=1&format=json&searchKeyword=${encodeURIComponent(keyword)}&resCoordType=WGS84GEO&reqCoordType=WGS84GEO&count=1`;
    const response = await fetch(url, { headers: { appKey: apiKey } });
    const data = await response.json() as TmapPoiResponse;

    const poi = data?.searchPoiInfo?.pois?.poi?.[0];
    if (!poi) return null;

    const lat = parseFloat(poi.noorLat);
    const lng = parseFloat(poi.noorLon);

    let address: string | null = null;
    const newAddr = poi.newAddressList?.newAddress?.[0];
    if (newAddr) {
        const parts = [newAddr.fullAddressRoad].filter(Boolean);
        if (parts.length > 0) address = parts.join(" ");
    }
    if (!address) {
        const parts = [poi.upperAddrName, poi.middleAddrName, poi.lowerAddrName, poi.detailAddrName].filter(Boolean);
        if (parts.length > 0) address = parts.join(" ");
    }

    if (!address) return null;
    return { address, lat: lat || 0, lng: lng || 0 };
}

/**
 * Tmap Geocoding — 주소 문자열 → 좌표 변환
 */
export async function geocodeByTmap(address: string, apiKey: string): Promise<{ lat: number; lng: number } | null> {
    if (!address?.trim() || !apiKey) return null;

    try {
        const poiUrl = `https://apis.openapi.sk.com/tmap/pois?version=1&format=json&searchKeyword=${encodeURIComponent(address)}&resCoordType=WGS84GEO&reqCoordType=WGS84GEO&count=1`;
        const poiRes = await fetch(poiUrl, { headers: { appKey: apiKey } });
        const poiData = await poiRes.json() as TmapPoiResponse;
        const poi = poiData?.searchPoiInfo?.pois?.poi?.[0];
        if (poi) {
            const lat = parseFloat(poi.noorLat);
            const lng = parseFloat(poi.noorLon);
            if (lat && lng) return { lat, lng };
        }

        const geoUrl = `https://apis.openapi.sk.com/tmap/geo/fullAddrGeo?version=1&format=json&coordType=WGS84GEO&fullAddr=${encodeURIComponent(address)}`;
        const geoRes = await fetch(geoUrl, { headers: { appKey: apiKey } });
        const geoData = await geoRes.json() as TmapGeoResponse;
        const item = geoData?.coordinateInfo?.coordinate?.[0];
        if (item) {
            const lat = parseFloat(item.newLat || item.lat);
            const lng = parseFloat(item.newLon || item.lon);
            if (lat && lng) return { lat, lng };
        }
    } catch (err: unknown) {
        console.warn("[AutoVerify] Tmap geocoding 실패:", (err as Error).message);
    }
    return null;
}

// ── 이메일 발송 ──

const EMAILJS_PUBLIC_KEY = "2G7A7gudLQ01I4hJW";
const EMAILJS_PRIVATE_KEY = defineString("EMAILJS_PRIVATE_KEY");
const EMAILJS_SERVICE_ID = "service_p4hpecv";
const EMAILJS_TEMPLATE_ID = "template_qmfktgb";
const SERVICE_URL = "https://vehicle-drive-log.web.app";

/**
 * 승인 이메일 발송 (서버 사이드)
 */
export async function sendApprovalEmailServer(recipientEmail: string, orgName: string, inviteCode: string, applicantName?: string): Promise<boolean> {
    try {
        const response = await emailjs.send(
            EMAILJS_SERVICE_ID,
            EMAILJS_TEMPLATE_ID,
            {
                to_email: recipientEmail,
                to_name: applicantName || orgName,
                name: applicantName || orgName,
                org_name: orgName,
                invite_code: inviteCode,
                service_url: `${SERVICE_URL}?code=${inviteCode}`,
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
export async function sendRejectionEmail(recipientEmail: string, orgName: string, reason: string): Promise<boolean> {
    try {
        const transporter = createGmailTransporter();

        const mailOptions = {
            from: systemMailFrom(),
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
