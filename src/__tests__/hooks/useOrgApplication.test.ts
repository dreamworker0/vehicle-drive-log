/**
 * useOrgApplication.test.ts — formatPhoneNumber 유틸 함수 및 useOrgApplication 통합 테스트
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useOrgApplication, { formatPhoneNumber } from '../../hooks/useOrgApplication';

// 1. Mocking 설정
let mockUser: { displayName: string | null; email: string | null } | null = null;
let mockLoading = false;

vi.mock('../../hooks/useAuth', () => ({
    useAuth: vi.fn(() => ({
        user: mockUser,
        loading: mockLoading,
    }))
}));

const mockSubmitOrgApplication = vi.fn();
vi.mock('firebase/functions', () => ({
    httpsCallable: vi.fn(() => mockSubmitOrgApplication)
}));

vi.mock('../../lib/firebase', () => ({
    firebaseFunctions: {}
}));

vi.mock('browser-image-compression', () => ({
    default: vi.fn((file) => Promise.resolve(file))
}));

// URL.createObjectURL 모킹 (jsdom 환경에서 정의되지 않을 수 있음)
if (typeof window !== 'undefined' && !window.URL.createObjectURL) {
    window.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
}

describe('formatPhoneNumber', () => {
    it('숫자만 추출하여 포맷', () => {
        expect(formatPhoneNumber('01012345678')).toBe('010-1234-5678');
    });

    it('3자리 이하는 그대로', () => {
        expect(formatPhoneNumber('010')).toBe('010');
        expect(formatPhoneNumber('01')).toBe('01');
    });

    it('4~7자리는 앞 3자리-나머지', () => {
        expect(formatPhoneNumber('0101234')).toBe('010-1234');
    });

    it('비숫자 문자 제거', () => {
        expect(formatPhoneNumber('010-1234-5678')).toBe('010-1234-5678');
        expect(formatPhoneNumber('abc010def1234ghi5678')).toBe('010-1234-5678');
    });

    it('11자리 초과는 잘림', () => {
        expect(formatPhoneNumber('010123456789999')).toBe('010-1234-5678');
    });

    it('빈 문자열', () => {
        expect(formatPhoneNumber('')).toBe('');
    });
});

describe('useOrgApplication 통합 테스트', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUser = null;
        mockLoading = false;
    });

    it('시나리오 1: 비로그인 마운트 - 신청자 이름과 이메일 필드가 빈 값이어야 함', () => {
        mockUser = null;
        mockLoading = false;
        
        const { result } = renderHook(() => useOrgApplication());
        
        expect(result.current.form.applicantName).toBe('');
        expect(result.current.form.applicantEmail).toBe('');
    });

    it('시나리오 2: 이미 로그인된 마운트 - 유저 정보로 자동 초기화되어야 함', () => {
        mockUser = { displayName: '홍길동', email: 'test@example.com' };
        mockLoading = false;
        
        const { result } = renderHook(() => useOrgApplication());
        
        expect(result.current.form.applicantName).toBe('홍길동');
        expect(result.current.form.applicantEmail).toBe('test@example.com');
    });

    it('시나리오 3: 비동기 로그인 로드 대응 - 로딩 완료 시점에 유저 정보가 동기화되어야 함', () => {
        mockUser = null;
        mockLoading = true;
        
        const { result, rerender } = renderHook(() => useOrgApplication());
        
        expect(result.current.form.applicantName).toBe('');
        
        // 비동기 로그인 완료
        mockUser = { displayName: '이순신', email: 'yi@example.com' };
        mockLoading = false;
        rerender();
        
        expect(result.current.form.applicantName).toBe('이순신');
        expect(result.current.form.applicantEmail).toBe('yi@example.com');
    });

    it('시나리오 4: 로그아웃 클린업 - 로그아웃 시 폼 데이터가 빈 문자열로 클린업되어야 함', () => {
        mockUser = { displayName: '홍길동', email: 'test@example.com' };
        mockLoading = false;
        
        const { result, rerender } = renderHook(() => useOrgApplication());
        expect(result.current.form.applicantName).toBe('홍길동');
        
        // 로그아웃 발생
        mockUser = null;
        rerender();
        
        expect(result.current.form.applicantName).toBe('');
        expect(result.current.form.applicantEmail).toBe('');
    });

    it('시나리오 5: 입력 양방향 바인딩 - 입력값이 폼 상태에 정확히 반영되어야 함', () => {
        const { result } = renderHook(() => useOrgApplication());
        
        act(() => {
            result.current.handleChange({
                target: { name: 'orgName', value: '참사랑복지관' }
            } as unknown as React.ChangeEvent<HTMLInputElement>);
            result.current.handleChange({
                target: { name: 'message', value: '안녕하세요' }
            } as unknown as React.ChangeEvent<HTMLTextAreaElement>);
            result.current.handlePhoneChange({
                target: { value: '01012345678' }
            } as unknown as React.ChangeEvent<HTMLInputElement>);
        });
        
        expect(result.current.form.orgName).toBe('참사랑복지관');
        expect(result.current.form.message).toBe('안녕하세요');
        expect(result.current.form.applicantPhone).toBe('010-1234-5678');
    });

    it('시나리오 6: 특정 영리 업종 차단 필터 - 종교단체, 학교, 병원 등 제출 차단', async () => {
        const { result } = renderHook(() => useOrgApplication());
        
        // 1. 종교단체 차단 테스트
        act(() => {
            result.current.handleChange({ target: { name: 'applicantName', value: '홍길동' } } as unknown as React.ChangeEvent<HTMLInputElement>);
            result.current.handleChange({ target: { name: 'applicantEmail', value: 'test@example.com' } } as unknown as React.ChangeEvent<HTMLInputElement>);
            result.current.handleChange({ target: { name: 'orgName', value: '은혜사랑교회' } } as unknown as React.ChangeEvent<HTMLInputElement>);
        });
        
        await act(async () => {
            await result.current.handleSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent<HTMLFormElement>);
        });
        expect(result.current.error).toContain('종교단체는 현재 서비스 대상이 아닙니다');

        // 2. 학교 차단 테스트
        act(() => {
            result.current.handleChange({ target: { name: 'orgName', value: '서울고등학교' } } as unknown as React.ChangeEvent<HTMLInputElement>);
        });
        await act(async () => {
            await result.current.handleSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent<HTMLFormElement>);
        });
        expect(result.current.error).toContain('학교는 현재 서비스 대상이 아닙니다');

        // 3. 병원 차단 테스트
        act(() => {
            result.current.handleChange({ target: { name: 'orgName', value: '희망정형외과의원' } } as unknown as React.ChangeEvent<HTMLInputElement>);
        });
        await act(async () => {
            await result.current.handleSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent<HTMLFormElement>);
        });
        expect(result.current.error).toContain('병원는 현재 서비스 대상이 아닙니다');
    });

    it('시나리오 7: 증빙 확장자 제한 - 허용되지 않은 파일 업로드 시 에러 검증', () => {
        const { result } = renderHook(() => useOrgApplication());
        const invalidFile = new File(['text'], 'test.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        
        act(() => {
            result.current.handleImageChange({
                target: { files: [invalidFile] }
            } as unknown as React.ChangeEvent<HTMLInputElement>);
        });
        
        expect(result.current.error).toBe('JPG, PNG 이미지 또는 PDF 파일만 업로드 가능합니다.');
        expect(result.current.imageFile).toBeNull();
    });

    it('시나리오 8: 증빙 용량 초과 제한 - 5MB 초과 파일 업로드 시 에러 검증', () => {
        const { result } = renderHook(() => useOrgApplication());
        const largeFile = new File([new ArrayBuffer(6 * 1024 * 1024)], 'large.png', { type: 'image/png' });
        
        act(() => {
            result.current.handleImageChange({
                target: { files: [largeFile] }
            } as unknown as React.ChangeEvent<HTMLInputElement>);
        });
        
        expect(result.current.error).toBe('파일 크기는 5MB 이하여야 합니다.');
        expect(result.current.imageFile).toBeNull();
    });

    it('시나리오 9: 최종 Callable Functions 제출 API Payload 성공 - 올바른 인자 전달 및 성공 상태 돌입', async () => {
        mockSubmitOrgApplication.mockResolvedValueOnce({ data: { success: true } });
        
        const { result } = renderHook(() => useOrgApplication());
        const validFile = new File(['image-data'], 'cert.png', { type: 'image/png' });
        
        act(() => {
            result.current.handleChange({ target: { name: 'applicantName', value: '홍길동' } } as unknown as React.ChangeEvent<HTMLInputElement>);
            result.current.handleChange({ target: { name: 'applicantEmail', value: 'test@example.com' } } as unknown as React.ChangeEvent<HTMLInputElement>);
            result.current.handleChange({ target: { name: 'orgName', value: '우리복지재단' } } as unknown as React.ChangeEvent<HTMLInputElement>);
            result.current.handleImageChange({ target: { files: [validFile] } } as unknown as React.ChangeEvent<HTMLInputElement>);
        });
        
        await act(async () => {
            await result.current.handleSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent<HTMLFormElement>);
        });
        
        expect(mockSubmitOrgApplication).toHaveBeenCalled();
        expect(result.current.success).toBe(true);
        expect(result.current.error).toBe('');
    });

    it('시나리오 10: resource-exhausted 한국어 에러 순화 검증 - 횟수 초과 안내로 전환되어야 함', async () => {
        const functionsError = new Error('Functions call failed: resource-exhausted');
        mockSubmitOrgApplication.mockRejectedValueOnce(functionsError);
        
        const { result } = renderHook(() => useOrgApplication());
        const validFile = new File(['image-data'], 'cert.png', { type: 'image/png' });
        
        act(() => {
            result.current.handleChange({ target: { name: 'applicantName', value: '홍길동' } } as unknown as React.ChangeEvent<HTMLInputElement>);
            result.current.handleChange({ target: { name: 'applicantEmail', value: 'test@example.com' } } as unknown as React.ChangeEvent<HTMLInputElement>);
            result.current.handleChange({ target: { name: 'orgName', value: '행복한복지관' } } as unknown as React.ChangeEvent<HTMLInputElement>);
            result.current.handleImageChange({ target: { files: [validFile] } } as unknown as React.ChangeEvent<HTMLInputElement>);
        });
        
        await act(async () => {
            await result.current.handleSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent<HTMLFormElement>);
        });
        
        expect(result.current.error).toBe('요청 횟수를 초과했습니다. 나중에 다시 시도해주세요.');
        expect(result.current.success).toBe(false);
    });

    it('시나리오 11: 일반 에러 순화 검증 - 일반 오류 시 표준 안내 메시지로 전환되어야 함', async () => {
        const genericError = new Error('Some internal database crash or permission-denied error');
        mockSubmitOrgApplication.mockRejectedValueOnce(genericError);
        
        const { result } = renderHook(() => useOrgApplication());
        const validFile = new File(['image-data'], 'cert.png', { type: 'image/png' });
        
        act(() => {
            result.current.handleChange({ target: { name: 'applicantName', value: '홍길동' } } as unknown as React.ChangeEvent<HTMLInputElement>);
            result.current.handleChange({ target: { name: 'applicantEmail', value: 'test@example.com' } } as unknown as React.ChangeEvent<HTMLInputElement>);
            result.current.handleChange({ target: { name: 'orgName', value: '행복한복지관' } } as unknown as React.ChangeEvent<HTMLInputElement>);
            result.current.handleImageChange({ target: { files: [validFile] } } as unknown as React.ChangeEvent<HTMLInputElement>);
        });
        
        await act(async () => {
            await result.current.handleSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent<HTMLFormElement>);
        });
        
        expect(result.current.error).toBe('신청 중 오류가 발생했습니다. 다시 시도해주세요.');
        expect(result.current.success).toBe(false);
    });
});
