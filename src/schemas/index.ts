import { z } from 'zod';
import type { QueryDocumentSnapshot, DocumentData, FirestoreDataConverter } from 'firebase/firestore';
import { captureError } from '../lib/sentry';

export * from './vehicle';
export * from './driveLog';
export * from './reservation';
export * from './user';
export * from './organization';

/**
 * Zod 스키마를 이용한 Firestore Converter를 생성합니다.
 * @param schema 변환에 사용할 Zod Object Schema
 * @returns FirestoreDataConverter
 */
export function createZodConverter<T extends z.ZodObject<any>>(schema: T): FirestoreDataConverter<z.infer<T> & { id: string }> {
    return {
        toFirestore(data: any): DocumentData {
            // Write 단계에서는 기존처럼 그대로 씁니다 (여기서도 원한다면 schema.parse() 사용 가능).
            // id 필드는 Firestore 문서의 id가 되므로 저장 시 제외합니다.
            const { id: _id, ...rest } = data;
            return rest;
        },
        fromFirestore(snapshot: QueryDocumentSnapshot): z.infer<T> & { id: string } {
            const data = snapshot.data();
            const parsed = schema.safeParse(data);
            if (!parsed.success) {
                // 파싱에 실패하더라도 애플리케이션 크래시를 막기 위해 Sentry에 경고성으로만 로깅합니다.
                captureError(new Error(`[Zod Error] Firestore document parsing failed`), {
                    docId: snapshot.id,
                    path: snapshot.ref.path,
                    errors: parsed.error.format(),
                    rawData: data,
                });
                // 파싱에 실패한 원시 데이터라도 렌더링에 사용될 수 있도록 fallback 반환을 할 수도 있으나
                // 컨버터 제네릭 타입 에러를 피하기 위해 강제 캐스팅으로 돌려줍니다.
                return { id: snapshot.id, ...data } as unknown as z.infer<T> & { id: string };
            }
            return { id: snapshot.id, ...parsed.data } as z.infer<T> & { id: string };
        }
    };
}
