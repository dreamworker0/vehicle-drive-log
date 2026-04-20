---
name: add-zod-validation
description: Zod를 이용한 런타임 데이터 검증 스키마 작성 및 타입스크립트 적용 패턴 가이드
---

# Zod Schema Validation Guide

기존 codebase에서 Firestore 데이터를 다루거나 외부 입력을 처리할 때 `as unknown as Type` 형태의 단언을 자주 사용하였습니다. 이는 런타임 오류나 디버깅 어려움을 초래할 수 있으므로, 핵심 데이터 로직에는 반드시 **Zod**를 사용하여 런타임 검증을 수행하는 패턴을 따릅니다.

## 1. 목적
- 런타임 에러 방지 (예상치 못한 데이터 구조 혹은 누락된 필수 필드 차단)
- 타입 단언(`as`) 제거로 인한 타입스립트 엄격성 향상
- 복잡한 폼 검증(Form Validation)을 간단하고 선언적으로 구성

## 2. Zod 스키마 작성 컨벤션
*   **위치**: `src/schemas/` 또는 관련 도메인 폴더(예: `src/types/`) 아래 별도 관리.
*   **네이밍 규칙**: 
    - Zod 스키마 변수명: `[ModelName]Schema` (예: `UserSchema`, `ReservationSchema`)
    - 추출된 타입 리터럴: `[ModelName]` (예: `User`, `Reservation`)

## 3. 예시 코드
```typescript
import { z } from 'zod';

// 1. Zod 스키마 정의
export const DriveLogSchema = z.object({
  id: z.string().optional(), // Firestore 문서 ID
  vehicleId: z.string().min(1, "차량 ID는 필수입니다."),
  driverId: z.string().min(1),
  distance: z.number().min(0, "거리는 0 이상이어야 합니다."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식이어야 합니다."),
  memo: z.string().optional(),
});

// 2. 타입 추출 자동화
export type DriveLog = z.infer<typeof DriveLogSchema>;
```

## 4. Firestore Fetch 통합 패턴
데이터베이스에서 가져온 결과를 클라이언트에서 확정하기 전에 `safeParse`나 `parse`를 활용합니다.
```typescript
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { DriveLogSchema, DriveLog } from './schemas/DriveLogSchema';

export async function fetchDriveLog(id: string): Promise<DriveLog | null> {
  const docRef = doc(db, 'driveLogs', id);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) return null;

  const data = { id: docSnap.id, ...docSnap.data() };
  
  // Zod 검증: 검증 실패 시 오류를 throw 하거나 로그를 남길 수 있습니다.
  const parsedData = DriveLogSchema.parse(data); 
  return parsedData;
}
```

## 5. 단계적 도입 지침
*   한 번에 모든 데이터를 Zod로 변경하지 말고, **새로운 데이터 필드를 추가하거나 중요한 로직(결제, 운행기록 저장)을 수정할 때** 우선적으로 Zod를 도입합니다.
*   Form 라이브러리(React Hook Form 등)와 결합할 때는 \`@hookform/resolvers/zod\`를 사용하여 간편하게 적용하세요.
