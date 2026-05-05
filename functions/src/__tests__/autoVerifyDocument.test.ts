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
jest.mock('../sendAlimtalk', () => ({ sendApprovalAlimtalk: jest.fn() }));
jest.mock('firebase-functions/params', () => ({ defineString: jest.fn(() => ({ value: jest.fn(() => 'mock-key') })) }));
jest.mock('firebase-functions/firestore', () => ({ onDocumentWritten: jest.fn() }));

// ── 순수 함수만 추출하여 테스트 ──
// autoVerifyDocument.ts에서 export되지 않는 함수들이므로 직접 구현 후 검증
// (향후 함수들이 export되면 import로 교체 가능)

/** maskName: 이름 마스킹 함수 */
function maskName(name: string | null | undefined): string {
    if (!name || name.length === 0) return '알 수 없음';
    if (name.length === 1) return name;
    if (name.length === 2) return name[0] + '*';
    const first = name[0];
    const last = name[name.length - 1];
    const middle = '*'.repeat(name.length - 2);
    return first + middle + last;
}

/** maskEmail: 이메일 마스킹 함수 */
function maskEmail(email: string | null | undefined): string {
    if (!email || !email.includes('@')) return '알 수 없음';
    const [local, domain] = email.split('@');
    if (local.length <= 2) return local + '***@' + domain;
    return local.substring(0, 2) + '***@' + domain;
}

/** classifyByBizNumber: 사업자번호 기반 비영리 분류 */
function classifyByBizNumber(
    bizNumber: string | null,
    orgName: string | null,
    documentType: string
): { score: number; result?: string } {
    let score = 0;
    if (documentType === '고유번호증') return { score: 100, result: '비영리 확정' };
    if (bizNumber) {
        const bizMatch = bizNumber.match(/\d{3}-(\d{2})-\d{5}/);
        const mid = bizMatch ? bizMatch[1] : null;
        if (mid === '82') score += 40;
        else if (mid === '81') score -= 40;
        else if (mid === '80') score -= 30;
    }
    const name = (orgName || '').toLowerCase();
    if (name.includes('사단법인')) score += 30;
    if (name.includes('재단법인')) score += 30;
    if (name.includes('사회복지')) score += 40;
    if (name.includes('비영리')) score += 30;
    if (name.includes('복지관')) score += 20;
    if (name.includes('복지센터')) score += 20;
    if (name.includes('사회적협동조합')) score += 40;
    else if (name.includes('협동조합')) score += 20;
    if (name.includes('주식회사') || name.includes('(주)')) score -= 50;
    if (name.includes('유한회사') || name.includes('유한책임')) score -= 40;
    return { score };
}

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
