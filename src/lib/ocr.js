import { getFunctions, httpsCallable } from 'firebase/functions';
import app from './firebase';

const functions = getFunctions(app, 'asia-northeast3');

/**
 * 계기판 OCR — 사진에서 누적Km(+배터리%) 추출
 * @param {string} imageBase64 - base64 인코딩된 이미지
 * @param {string} mimeType - 이미지 MIME 타입 (image/jpeg 등)
 * @param {boolean} isElectric - 전기차 여부
 * @returns {Promise<{km: number|null, battery: number|null, raw: string}>}
 */
export const ocrDashboard = async (imageBase64, mimeType, isElectric = false) => {
    const callable = httpsCallable(functions, 'ocrDashboard', { timeout: 60000 });
    const result = await callable({ imageBase64, mimeType, isElectric });
    return result.data;
};

/**
 * 고유번호증 OCR — 문서 유형 판별 + 정보 추출 + 검증
 * @param {string} imageUrl - Storage에 저장된 이미지 URL
 * @param {string} orgName - 입력한 기관명
 * @returns {Promise<{documentType, uniqueNumber, extractedName, nameMatch, address, aiVerified, rejected, rejectReason}>}
 */
export const ocrDocumentVerify = async (imageUrl, orgName) => {
    const callable = httpsCallable(functions, 'ocrDocument', { timeout: 120000 });
    const result = await callable({ imageUrl, orgName });
    return result.data;
};
