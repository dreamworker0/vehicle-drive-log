/**
 * verifyHelpers — 기관 자동 검증 공통 유틸리티
 *
 * autoVerifyDocument.ts에서 분리된 헬퍼 함수 및 이메일 발송 로직.
 */
import { getStorage } from "firebase-admin/storage";
import * as emailjs from "@emailjs/nodejs";
import { EMAILJS_PRIVATE_KEY } from "../../core/params";
import { createGmailTransporter, systemMailFrom } from "../../core/mailer";
import { maskEmail } from "../../utils/mask";
import { escapeHtml } from "../../utils/helpers";
import * as logger from "firebase-functions/logger";

// ── 마스킹 유틸리티 ──
// 구현은 utils/mask.ts로 승격됨 (알림톡·이메일 로그 마스킹과 공용).
// 기존 import 경로 호환을 위해 re-export 유지.
export { maskName, maskEmail } from "../../utils/mask";

// ── 비영리 판별 ──
// 구현은 documentScreen.ts로 이관됨 (접수 프리스크린과 공용 — 접수 경로가 이메일 발송
// 모듈까지 끌어오지 않도록 분리). 기존 import 경로 호환을 위해 re-export 유지.
export { classifyByBizNumber } from "./documentScreen";

// ── 파일 유틸리티 ──

/**
 * Firebase Storage download URL에서 파일을 다운로드하여 base64로 변환
 *
 * Admin SDK 다운로드는 URL의 토큰을 무시하고 경로만 사용하므로, 호출자가 URL을 조작해
 * 타 기관 파일을 읽을 수 있다. expectedPathPrefix로 허용 경로를 강제한다 (2026-07-10 감사 #3).
 */
export async function downloadFileAsBase64(pathOrUrl: string, expectedPathPrefix?: string): Promise<{ base64: string; mimeType: string }> {
    const storage = getStorage();
    // 레거시 토큰 URL이면 경로를 역추출하고, 아니면 이미 Storage 경로로 간주한다.
    // (2026-07-18 보안 재검증 P0-3 — 신규 문서는 토큰 URL 대신 경로를 저장한다.)
    // 쿼리스트링/프래그먼트 전까지 매칭 — 쿼리 파라미터가 없어도 견고하게 동작한다.
    const urlMatch = pathOrUrl.match(/\/o\/([^?#]+)/);
    const filePath = urlMatch ? decodeURIComponent(urlMatch[1]) : pathOrUrl;
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
        logger.warn("[AutoVerify] Tmap geocoding 실패:", (err as Error).message);
    }
    return null;
}

// ── 이메일 발송 ──

const EMAILJS_PUBLIC_KEY = "2G7A7gudLQ01I4hJW";
// EMAILJS_PRIVATE_KEY는 defineSecret(core/params)로 이관 — 사용 함수는 secrets 선언 필수
const EMAILJS_SERVICE_ID = "service_p4hpecv";
const EMAILJS_TEMPLATE_ID = "template_qmfktgb";
const SERVICE_URL = "https://drivelog.socialprism.co.kr";

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
        logger.info(`[AutoVerify] 📧 승인 이메일 발송 성공: ${maskEmail(recipientEmail)}`, response.status, response.text);
        return true;
    } catch (err: unknown) {
        logger.error(`[AutoVerify] ❌ 승인 이메일 발송 실패: ${maskEmail(recipientEmail)}`, err);
        return false;
    }
}

/** 거부 이메일의 상황별 안내 — 사유만으로는 신청자가 다음에 무엇을 할지 모를 때 붙인다 */
export interface RejectionEmailOptions {
    /** 머리글. 기본값 "기관 신청이 승인되지 않았습니다" */
    title?: string;
    /** "이렇게 해 주세요" 상자에 한 줄씩 보여줄 안내 */
    guidance?: string[];
}

/**
 * 같은 고유번호로 이미 **승인된** 기관이 있을 때의 안내.
 *
 * 2026-11-28: 첫 신청 이메일을 잘못 적어 승인 메일을 못 받은 기관이 다시 신청했다가
 * "승인되지 않았습니다" 메일만 받았다. 기관은 이미 쓸 수 있는 상태이므로, 거절이 아니라
 * "초대 코드로 가입하면 된다"는 길을 알려야 한다.
 */
export const DUPLICATE_APPROVED_EMAIL: RejectionEmailOptions = {
    title: "이미 승인된 기관입니다",
    guidance: [
        "같은 고유번호로 승인된 기관이 이미 있어서 이번 신청은 새로 만들지 않았습니다. 기관은 지금 바로 쓸 수 있습니다.",
        "기관이 승인될 때 처음 신청하신 분의 카카오톡(알림톡)과 이메일로 6자리 초대 코드가 발송되었습니다. 카카오톡 \"차량 운행일지\" 메시지를 먼저 확인해 주세요.",
        `초대 코드를 받았다면 ${SERVICE_URL} 에 구글 계정으로 로그인한 뒤 코드를 입력하면 가입됩니다. 이 코드로 처음 가입하는 계정이 기관관리자가 됩니다.`,
        "카카오톡 안에서 링크를 열면 구글 로그인이 막힙니다. 크롬이나 삼성 인터넷 같은 일반 브라우저에서 열어 주세요.",
        "이미 기관관리자가 있다면 그분께 초대 코드를 받아 가입하시면 됩니다. 초대 코드를 받지 못하셨다면 관리자에게 연락해 주세요.",
    ],
};

/** 같은 고유번호의 신청이 이미 **심사 중**일 때의 안내 */
export const DUPLICATE_PENDING_EMAIL: RejectionEmailOptions = {
    guidance: [
        "같은 기관의 신청이 이미 접수되어 심사 중이라 이번 신청은 접수하지 않았습니다.",
        "먼저 접수된 신청의 결과가 카카오톡(알림톡)과 이메일로 안내됩니다. 다시 신청하지 말고 결과를 기다려 주세요.",
    ],
};

/**
 * 거부 이메일 발송 (Nodemailer — Gmail SMTP)
 */
export async function sendRejectionEmail(
    recipientEmail: string,
    orgName: string,
    reason: string,
    options: RejectionEmailOptions = {},
): Promise<boolean> {
    try {
        const transporter = createGmailTransporter();
        const title = options.title || "기관 신청이 승인되지 않았습니다";
        const guidanceHtml = options.guidance?.length
            ? `
                        <div style="margin-top: 20px; padding: 16px; background: #EFF6FF; border-radius: 8px; border: 1px solid #BFDBFE;">
                            <p style="margin: 0 0 8px; color: #1E40AF; font-size: 14px; font-weight: 600;">이렇게 해 주세요</p>
                            <ul style="margin: 0; padding-left: 20px; color: #1E3A8A; font-size: 14px; line-height: 1.6;">
                                ${options.guidance.map((line) => `<li style="margin-bottom: 4px;">${escapeHtml(line)}</li>`).join("")}
                            </ul>
                        </div>`
            : "";

        const mailOptions = {
            from: systemMailFrom(),
            to: recipientEmail,
            subject: `[차량운행일지] 기관 신청 결과 안내: ${orgName}`,
            html: `
                <div style="font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="background: linear-gradient(135deg, #EF4444, #DC2626); color: white; padding: 24px; border-radius: 12px 12px 0 0;">
                        <h2 style="margin: 0; font-size: 20px;">${escapeHtml(title)}</h2>
                    </div>
                    <div style="background: #F8FAFC; padding: 24px; border: 1px solid #E2E8F0; border-top: none; border-radius: 0 0 12px 12px;">
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr>
                                <td style="padding: 12px 0; border-bottom: 1px solid #E2E8F0; color: #64748B; width: 100px;">기관명</td>
                                <td style="padding: 12px 0; border-bottom: 1px solid #E2E8F0; font-weight: 600; color: #1E293B;">${escapeHtml(orgName)}</td>
                            </tr>
                            <tr>
                                <td style="padding: 12px 0; color: #64748B;">거부 사유</td>
                                <td style="padding: 12px 0; color: #DC2626; font-weight: 600;">${escapeHtml(reason)}</td>
                            </tr>
                        </table>${guidanceHtml}
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
        logger.info(`[AutoVerify] 📧 거부 이메일 발송 성공: ${maskEmail(recipientEmail)}`);
        return true;
    } catch (err: unknown) {
        logger.error(`[AutoVerify] ❌ 거부 이메일 발송 실패: ${maskEmail(recipientEmail)}`, (err as Error).message);
        return false;
    }
}
