/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { createZodConverter } from '../../schemas/index';
import { captureError } from '../../lib/sentry';

// Sentry captureError 함수 Mocking
vi.mock('../../lib/sentry', () => ({
    captureError: vi.fn(),
}));

describe('createZodConverter', () => {
    // 테스트용 임시 스키마
    const testSchema = z.object({
        name: z.string(),
        age: z.number().catch(20),
    });

    const converter = createZodConverter(testSchema);

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('toFirestore', () => {
        it('저장 시 id 필드를 제외하고 순수 데이터만 직렬화하여 반환한다', () => {
            const dataToSave = { id: 'doc-123', name: '홍길동', age: 30 };
            const result = converter.toFirestore(dataToSave);
            
            expect(result).toEqual({ name: '홍길동', age: 30 });
            expect(result).not.toHaveProperty('id');
        });
    });

    describe('fromFirestore', () => {
        it('정상적인 Firestore 스냅샷 데이터 수신 시, 스키마 파싱 및 id를 결합하여 반환한다', () => {
            const mockSnapshot = {
                id: 'doc-success',
                ref: { path: 'test-collection/doc-success' },
                data: () => ({ name: '이순신', age: 45 }),
            } as any;

            const result = converter.fromFirestore(mockSnapshot);
            
            expect(result).toEqual({
                id: 'doc-success',
                name: '이순신',
                age: 45,
            });
            expect(captureError).not.toHaveBeenCalled();
        });

        it('데이터가 유효하지 않아 Zod 스키마 파싱에 실패하면, Sentry에 에러를 기록하고 원시 데이터에 id만 추가하여 강제 캐스팅 반환한다(UI 장애 방지)', () => {
            const mockBadSnapshot = {
                id: 'doc-fail',
                ref: { path: 'test-collection/doc-fail' },
                data: () => ({ name: 123, age: 'invalid-age-type' }), // 스키마 형식 불일치
            } as any;

            const result = converter.fromFirestore(mockBadSnapshot);
            
            // UI 크래시를 막기 위해 파싱은 안 됐더라도 원시 정보가 그대로 들어가서 반환되는지 검증
            expect(result).toEqual({
                id: 'doc-fail',
                name: 123,
                age: 'invalid-age-type',
            });
            
            // Sentry captureError 로깅이 제대로 트리거 되었는지 검증
            expect(captureError).toHaveBeenCalledTimes(1);
            
            // 첫 번째 인자로 전달된 Error 메시지에 Zod 파싱 실패 관련 상세 경로가 포함되어 있는지 검증
            const loggedError = vi.mocked(captureError).mock.calls[0][0] as Error;
            expect(loggedError.message).toContain('[Zod] Parsing failed for test-collection/doc-fail');
            
            // 두 번째 인자로 전달된 메타데이터에 상세 raw 데이터 및 에러 포맷이 포함되어 있는지 검증
            const errorMeta = vi.mocked(captureError).mock.calls[0][1];
            expect(errorMeta).toEqual(
                expect.objectContaining({
                    docId: 'doc-fail',
                    path: 'test-collection/doc-fail',
                    rawData: { name: 123, age: 'invalid-age-type' },
                })
            );
        });
    });
});
