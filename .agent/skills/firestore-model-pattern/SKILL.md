---
name: firestore-model-pattern
description: Firestore 데이터 스키마 정의(타입/필드 추가) 및 CRUD 데이터 접근 함수 구현 패턴 가이드
---

# 🗄️ Firestore 데이터 모델 패턴 (Schema & CRUD Functions)

이 가이드는 Firestore 데이터베이스에 새로운 데이터 필드를 추가하거나, 도메인별 데이터를 조작하기 위한 CRUD(생성/조회/수정/삭제) 함수를 구현할 때 따라야 할 단일화된 개발 패턴을 정의합니다.

---

## 1. 데이터 모델 정의 및 필드 추가 (Schema)

기존 컬렉션에 새 필드를 추가하거나 신규 데이터 타입을 정의할 때의 구조입니다.

### 1.1 필드는 Zod 스키마에만 추가한다 (단일 원본)
*   **위치**: `src/schemas/` 디렉토리 하위의 도메인 파일. **`src/types/`를 고치지 않는다.**
*   `src/types/<도메인>.ts`의 도메인 타입은 `z.infer<typeof xSchema> & FirestoreDoc`으로 **파생**된다. 스키마에 추가하면 타입이 따라오고, 두 곳에 각각 선언하면 다시 어긋난다.
*   **원칙**: 기존에 생성된 문서들에는 새 필드가 존재하지 않으므로, 데이터 정합성 깨짐을 방지하기 위해 **반드시 새 필드는 `.optional()`로 선언**해야 합니다.

```typescript
// src/schemas/organization.ts 예시
export const organizationSchema = z.object({
    name: z.string().catch(''),
    /** 신청 시 남긴 메시지 */
    message: z.string().optional().catch(undefined),  // ← 새 필드는 항상 optional
});

// src/types/organization.ts — 손대지 않는다. 아래 한 줄이 위 스키마를 따라간다.
// export type Organization = z.infer<typeof organizationSchema> & FirestoreDoc;
```

> ⚠️ **스키마에 빠뜨리면 조용히 죽는다.** `createZodConverter`의 `fromFirestore`는 Zod가 모르는 키를 제거한다(`z.object` 기본 동작). 저장은 되는데 앱에서는 항상 `undefined`가 되어, 코드가 멀쩡한데 화면에만 안 나오는 상태가 된다. 실제로 차량 `currentBattery`(🔋 배지)와 예약 `syncSource`(📅 배지)가 이 방식으로 죽어 있었다. 회귀 방지는 `src/__tests__/schemas/schemaCoverage.test.ts`에 있으니 새 필드도 여기에 한 줄 추가한다.

### 1.1.1 시각 필드
읽기 타입은 `FieldValue`를 포함하지 않는다(`schemas/common.ts`의 `timestampSchema`). `serverTimestamp()`를 심는 쓰기 지점에서만 `WithServerTimestamps<T, 'createdAt'>`로 해당 필드를 넓힌다. Timestamp인지 Date인지 판정해야 하면 `toDateOrNull`(`lib/dateUtils`)을 쓴다 — 호출부에서 직접 `toDate` 유무를 분기하지 않는다.

### 1.2 UI 렌더링 시 하위 호환성 보장
기존 문서에 해당 필드가 없는 경우를 위해 렌더링 시 옵셔널 체이닝(`?.`) 및 조건부 렌더링(`&&`)을 필수 적용합니다.
```tsx
{/* 하위 호환성 보장 렌더링 */}
{orgData?.message && (
    <div className="mt-2 text-surface-700 dark:text-surface-300">
        {orgData.message}
    </div>
)}
```

---

## 2. CRUD 데이터 접근 함수 추가 (Repository)

### 2.1 도메인별 파일 분리 규칙
모든 CRUD 및 실시간 구독 쿼리 함수는 `src/lib/firestore/` 디렉토리에 도메인별 파일로 완벽히 분리되어 있어야 합니다.

*   `src/lib/firestore/driveLogs.ts`: 운행일지 기록 CRUD
*   `src/lib/firestore/reservations.ts`: 차량 예약 관련 쿼리
*   `src/lib/firestore/vehicles.ts`: 차량 등록/수정/퇴역 관리
*   `src/lib/firestore/users.ts`: 사용자 프로필 및 소속 관리
*   `src/lib/firestore/index.ts`: 모든 CRUD 함수를 외부로 re-export하는 진입점

### 2.2 CRUD 표준 함수 작성 템플릿
```typescript
import { db } from '../firebase';
import { collection, query, where, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';

// 1. 목록 조회 (멀티테넌트 격리를 위한 organizationId 필터 필수)
export const getDomainItems = async (orgId: string) => {
    const q = query(
        collection(db, 'domainCollection'),
        where('organizationId', '==', orgId)
    );
    const snap = await getDocs(q);
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

// 2. 단건 생성
export const createDomainItem = async (data: Record<string, any>) => {
    const docRef = await addDoc(collection(db, 'domainCollection'), {
        ...data,
        createdAt: serverTimestamp() // 생성일은 Firestore 서버타임스탬프 권장
    });
    return docRef.id;
};
```

---

## 3. re-export 및 모듈 진입점 규칙

도메인 파일에 작성한 모든 데이터 접근 함수는 반드시 **`src/lib/firestore/index.ts`에서 re-export** 해야 하며, 컴포넌트에서는 개별 파일이 아닌 이 index.ts 진입점을 통해서만 함수를 가져와야 합니다.

```typescript
// src/lib/firestore/index.ts
export { getDomainItems, createDomainItem } from './domainFile';
```

```tsx
// 컴포넌트 호출 예시
import { getDomainItems } from '../../lib/firestore';
```

---

## 4. 데이터 추가/수정 시 체크리스트

- [ ] `src/types/` 인터페이스 파일에 optional(`?`) 필드 추가 완료
- [ ] 쿼리 시 멀티테넌트 방어를 위해 `organizationId` 필터링이 적용되었는지 확인
- [ ] 복합 쿼리를 사용하는 경우 `firestore.indexes.json`에 복합 인덱스 등록
- [ ] `tsc --noEmit`을 실행하여 타입 컴파일 에러 유무 확인
