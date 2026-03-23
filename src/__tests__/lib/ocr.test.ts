import { describe, it, expect, vi } from 'vitest';

// Firebase 모킹
vi.mock('firebase/functions', () => ({
    getFunctions: vi.fn(() => ({})),
    httpsCallable: vi.fn(() => vi.fn()),
}));
vi.mock('../../lib/firebase', () => ({ default: {} }));

describe('OCR 모듈', () => {
    it('ocrDashboard 함수를 export해야 한다', async () => {
        const mod = await import('../../lib/ocr.js');
        expect(typeof mod.ocrDashboard).toBe('function');
    });

    it('ocrDocumentVerify 함수를 export해야 한다', async () => {
        const mod = await import('../../lib/ocr.js');
        expect(typeof mod.ocrDocumentVerify).toBe('function');
    });

    it('ocrDashboard 호출 시 Cloud Function을 호출해야 한다', async () => {
        const { httpsCallable } = await import('firebase/functions');
        const mockCallable = vi.fn().mockResolvedValue({ data: { km: 12345, battery: null, raw: '12345' } });
        vi.mocked(httpsCallable).mockReturnValue(mockCallable as unknown as ReturnType<typeof httpsCallable>);

        const { ocrDashboard } = await import('../../lib/ocr.js');
        const result = await ocrDashboard('base64data', 'image/jpeg', false);

        expect(mockCallable).toHaveBeenCalledWith({
            imageBase64: 'base64data',
            mimeType: 'image/jpeg',
            isElectric: false,
        });
        expect(result).toEqual({ km: 12345, battery: null, raw: '12345' });
    });
});
