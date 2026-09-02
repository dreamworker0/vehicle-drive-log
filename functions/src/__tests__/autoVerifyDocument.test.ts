/**
 * autoVerifyDocument.test.ts
 * - maskName, maskEmail, classifyByBizNumber 등 순수 함수 단위 테스트
 * - Gemini API, Firebase Admin, EmailJS 등 외부 의존성은 모두 mock 처리
 */

// ── Firebase Admin SDK Mock (파일 로드 시 초기화 에러 방지) ──
jest.mock('firebase-admin/firestore', () => ({
    getFirestore: jest.fn(() => ({
        collection: jest.fn(),
        doc: jest.fn(),
    })),
    FieldValue: { serverTimestamp: jest.fn() },
}));
jest.mock('firebase-admin/storage', () => ({
    getStorage: jest.fn(() => ({ bucket: jest.fn(() => ({ file: jest.fn() })) })),
}));
jest.mock('@google/genai', () => ({ GoogleGenAI: jest.fn() }));
jest.mock('@emailjs/nodejs', () => ({ send: jest.fn() }));
jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));
jest.mock('../services/alimtalk/sendAlimtalk', () => ({ sendApprovalAlimtalk: jest.fn() }));
jest.mock('firebase-functions/params', () => ({
    defineString: jest.fn(() => ({ value: jest.fn(() => 'mock-key') })),
    defineSecret: jest.fn(() => ({ value: jest.fn(() => 'mock-secret') })),
}));
jest.mock('firebase-functions/firestore', () => ({ onDocumentWritten: jest.fn() }));

// ── 원본을 import한다 ──
// 종전에는 "export되지 않는 함수"라는 이유로 maskName/maskEmail/classifyByBizNumber를 이 파일에
// **다시 구현해** 사본을 검사했다. 그동안 원본은 utils/mask.ts·services/driveLog/documentScreen.ts로
// 이관돼 export되어 있었으므로, 이 테스트는 원본 코드를 한 줄도 실행하지 않는 녹색 신호였다 (2026-09-02).
import { maskName, maskEmail } from '../utils/mask';
import { classifyByBizNumber } from '../services/driveLog/documentScreen';

// ──────────────────────────────────────────────────
describe('maskName()', () => {
    it('null → "알 수 없음"', () => {
        expect(maskName(null)).toBe('알 수 없음');
    });
    it('undefined → "알 수 없음"', () => {
        expect(maskName(undefined)).toBe('알 수 없음');
    });
    it('빈 문자열 → "알 수 없음"', () => {
        expect(maskName('')).toBe('알 수 없음');
    });
    it('1글자 이름 → 그대로', () => {
        expect(maskName('김')).toBe('김');
    });
    it('2글자 이름 → 두 번째 마스킹', () => {
        expect(maskName('김수')).toBe('김*');
    });
    it('3글자 이름 → 중간 마스킹', () => {
        expect(maskName('홍길동')).toBe('홍*동');
    });
    it('4글자 이름 → 중간 2자리 마스킹', () => {
        expect(maskName('황보길동')).toBe('황**동');
    });
});

describe('maskEmail()', () => {
    it('null → "알 수 없음"', () => {
        expect(maskEmail(null)).toBe('알 수 없음');
    });
    it('@가 없는 이메일 → "알 수 없음"', () => {
        expect(maskEmail('notanemail')).toBe('알 수 없음');
    });
    it('일반 이메일 → 앞 2글자만 노출', () => {
        expect(maskEmail('example@email.com')).toBe('ex***@email.com');
    });
    it('로컬 파트가 2글자 이하 → 전체 + ***', () => {
        expect(maskEmail('ab@email.com')).toBe('ab***@email.com');
    });
    it('로컬 파트가 1글자 → 전체 + ***', () => {
        expect(maskEmail('a@email.com')).toBe('a***@email.com');
    });
});

describe('classifyByBizNumber()', () => {
    it('고유번호증이면 score=100, "비영리 확정" 반환', () => {
        const result = classifyByBizNumber(null, null, '고유번호증');
        expect(result).toEqual({ score: 100, result: '비영리 확정' });
    });

    it('사업자번호 중간 82 → +40점', () => {
        const result = classifyByBizNumber('123-82-12345', null, '사업자등록증(비영리)');
        expect(result.score).toBe(40);
    });

    it('사업자번호 중간 81 → -40점', () => {
        const result = classifyByBizNumber('123-81-12345', null, '사업자등록증(영리)');
        expect(result.score).toBe(-40);
    });

    it('사회복지 포함 기관명 → +40점', () => {
        const result = classifyByBizNumber(null, '행복사회복지관', '기타');
        expect(result.score).toBeGreaterThanOrEqual(40);
    });

    it('주식회사 포함 → -50점', () => {
        const result = classifyByBizNumber(null, '(주)행복주식회사', '기타');
        expect(result.score).toBeLessThanOrEqual(-50);
    });

    it('사단법인 + 복지관 조합 → 높은 점수', () => {
        const result = classifyByBizNumber(null, '사단법인 행복복지관', '기타');
        expect(result.score).toBeGreaterThanOrEqual(50);
    });

    it('빈 사업자번호 및 기관명 → 0점', () => {
        const result = classifyByBizNumber(null, null, '기타');
        expect(result.score).toBe(0);
    });
});
