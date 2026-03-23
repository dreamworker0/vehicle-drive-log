import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// ── Mocks ──
vi.mock('../../lib/ocr', () => ({
    ocrDashboard: vi.fn().mockResolvedValue({ km: 55000, battery: null, raw: '55000 km' }),
}));

vi.mock('firebase/storage', () => ({
    ref: vi.fn(),
    uploadBytes: vi.fn().mockResolvedValue({}),
    getDownloadURL: vi.fn().mockResolvedValue('https://storage.test/image.jpg'),
}));

vi.mock('../../lib/firebase', () => ({
    storage: {},
}));

vi.mock('../../lib/firestore', () => ({
    createFeedback: vi.fn().mockResolvedValue('fb1'),
}));

import useDriveLogOcr from '../../hooks/useDriveLogOcr';

describe('useDriveLogOcr', () => {
    const mockSetForm = vi.fn();
    const defaultProps = {
        isElectric: false,
        setForm: mockSetForm,
        user: { uid: 'emp1', email: 'emp@test.com', displayName: '김직원' } as Parameters<typeof useDriveLogOcr>[0]['user'],
        userData: { name: '김직원', organizationId: 'org1' },
        vehicleName: '소나타',
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('초기 상태가 올바르다', () => {
        const { result } = renderHook(() => useDriveLogOcr(defaultProps));

        expect(result.current.ocrLoading).toBe(false);
        expect(result.current.ocrError).toBe('');
        expect(result.current.ocrSuccess).toBe(false);
        expect(result.current.ocrReportSending).toBe(false);
        expect(result.current.ocrReportSent).toBe(false);
    });

    it('cameraInputRef와 endKmInputRef가 존재한다', () => {
        const { result } = renderHook(() => useDriveLogOcr(defaultProps));

        expect(result.current.cameraInputRef).toBeDefined();
        expect(result.current.endKmInputRef).toBeDefined();
    });

    it('handleOcrCapture 함수가 존재한다', () => {
        const { result } = renderHook(() => useDriveLogOcr(defaultProps));

        expect(typeof result.current.handleOcrCapture).toBe('function');
    });

    it('handleOcrReport 함수가 존재한다', () => {
        const { result } = renderHook(() => useDriveLogOcr(defaultProps));

        expect(typeof result.current.handleOcrReport).toBe('function');
    });

    it('전기차 모드에서도 초기화된다', () => {
        const { result } = renderHook(() =>
            useDriveLogOcr({ ...defaultProps, isElectric: true }),
        );

        expect(result.current.ocrLoading).toBe(false);
        expect(result.current.ocrSuccess).toBe(false);
    });
});
