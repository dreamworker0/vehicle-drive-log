---
name: add-firestore-fn
description: src/lib/firestore/ 디렉터리에 새 Firestore 함수를 추가하고 컴포넌트에서 사용하는 패턴 가이드
---

# Firestore 함수 추가 스킬

## firestore/ 디렉터리 구조

`src/lib/firestore/`는 **도메인별로 분리**된 TypeScript 모듈 구조입니다:

```
src/lib/firestore/
├── index.ts              ← 모듈 re-export 진입점
├── dailyLogQueries.ts    ← 일일 운행일지 쿼리
├── driveLogs.ts          ← 운행일지 CRUD
├── favorites.ts          ← 즐겨찾기 CRUD
├── feedbacks.ts          ← 피드백 CRUD
├── fuelLogs.ts           ← 주유 기록 CRUD
├── hipass.ts             ← 하이패스 단말기 관리
├── hipassCharges.ts      ← 하이패스 충전 기록
├── holidays.ts           ← 휴일 관리
├── maintenance.ts        ← 정비 기록 CRUD
├── notifications.ts      ← 알림 CRUD
├── organizations.ts      ← 기관 관리 CRUD
├── reservations.ts       ← 예약 CRUD
├── superAdmin.ts         ← 시스템 관리자 전용 함수
├── users.ts              ← 사용자 CRUD
└── vehicles.ts           ← 차량 CRUD
```

컴포넌트에서는 항상 `index.ts`를 통해 import합니다:

```ts
import { getVehicles, createDriveLog } from '../../lib/firestore';
```

## 함수 추가 패턴

### 새 함수를 추가할 도메인 파일 선택

| 도메인 | 파일 | 주요 함수 |
|--------|------|-----------|
| 운행일지 | `driveLogs.ts` | `createDriveLog`, `getDriveLogs`, `getMyDriveLogs`, `getLastVehicleEndKm` |
| 일일 운행일지 | `dailyLogQueries.ts` | 일일 운행일지 쿼리 (집계/필터) |
| 주유 기록 | `fuelLogs.ts` | 주유 기록 CRUD |
| 하이패스 단말기 | `hipass.ts` | 하이패스 단말기 관리 |
| 하이패스 충전 | `hipassCharges.ts` | 하이패스 충전 기록 CRUD |
| 차량 | `vehicles.ts` | `getVehicles`, `createVehicle`, `updateVehicle`, `deleteVehicle` |
| 예약 | `reservations.ts` | `createReservationSafe`, `getReservations`, `cancelReservation` |
| 사용자 | `users.ts` | `getUser`, `createUser`, `updateUser`, `leaveOrganization` |
| 기관 | `organizations.ts` | `createOrganization`, `approveOrganization`, `findOrganizationByInviteCode` |
| 정비 | `maintenance.ts` | `getMaintenanceRecords`, `createMaintenanceRecord`, `retireVehicle` |
| 알림 | `notifications.ts` | `createNotification`, `subscribeNotifications`, `markNotificationRead` |
| 즐겨찾기 | `favorites.ts` | `getFavorites`, `createFavorite`, `deleteFavorite` |
| 피드백 | `feedbacks.ts` | `createFeedback`, `getAllFeedbacks`, `subscribeFeedbacks` |
| 휴일 | `holidays.ts` | `getCustomHolidays`, `addCustomHoliday`, `deleteCustomHoliday` |
| 슈퍼관리자 | `superAdmin.ts` | `getSuperAdmins`, `addSuperAdmin`, `removeSuperAdmin` |

### 단순 CRUD 함수

```ts
// 데이터 조회 (단건)
export const getItem = async (itemId: string) => {
    const snap = await getDoc(doc(db, 'collectionName', itemId));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
};

// 데이터 조회 (목록, 필터 포함)
export const getItems = async (orgId: string) => {
    const q = query(
        collection(db, 'collectionName'),
        where('organizationId', '==', orgId),
        orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// 데이터 생성
export const createItem = async (data: Record<string, unknown>) => {
    const docRef = await addDoc(collection(db, 'collectionName'), {
        ...data,
        createdAt: serverTimestamp(),
    });
    return docRef.id;
};

// 데이터 수정
export const updateItem = async (itemId: string, data: Record<string, unknown>) => {
    await updateDoc(doc(db, 'collectionName', itemId), data);
};

// 데이터 삭제
export const deleteItem = async (itemId: string) => {
    await deleteDoc(doc(db, 'collectionName', itemId));
};
```

### 실시간 구독 함수

```ts
export const subscribeItems = (orgId: string, callback: (items: Record<string, unknown>[]) => void) => {
    const q = query(
        collection(db, 'collectionName'),
        where('organizationId', '==', orgId),
        orderBy('createdAt', 'desc')
    );
    return onSnapshot(q, (snapshot) => {
        const items = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(items);
    });
};
```

### Cloud Function onCall 호출 함수

```ts
export const callMyFunction = async (data: Record<string, unknown>) => {
    const fn = httpsCallable(functions, 'myFunction');
    const result = await fn(data);
    return result.data;
};
```

## index.ts에 등록

새 함수를 도메인 파일에 추가한 후, `index.ts`에서 re-export합니다:

```ts
// index.ts — 기존 export에 새 함수 추가
export { getItems, createItem, /* 기존 함수들... */ } from './driveLogs';
```

> `index.ts`에서 re-export하지 않으면 외부에서 import할 수 없다.

### 완전히 새로운 도메인이라면

1. `src/lib/firestore/newDomain.ts` 파일 생성
2. `index.ts`에 새 파일의 export 추가

## 컴포넌트에서 사용

```tsx
import { getItems, createItem } from '../../lib/firestore';

// useEffect에서 조회
useEffect(() => {
    const load = async () => {
        const items = await getItems(userData.organizationId);
        setItems(items);
    };
    load();
}, [userData]);

// 이벤트 핸들러에서 생성
const handleCreate = async () => {
    await createItem({ ...formData, organizationId: userData.organizationId });
};
```

## 주의사항

1. **도메인별 파일 분리**: 관련 없는 도메인 파일에 함수를 넣지 않는다
2. **import 확인**: 도메인 파일 상단에서 필요한 Firestore SDK 함수가 이미 import되어 있는지 확인
3. **organizationId 필수**: 대부분의 쿼리에 `organizationId` 필터 포함 (멀티테넌트 구조)
4. **Firestore 인덱스**: 복합 쿼리 사용 시 `firestore.indexes.json`에 인덱스 추가 필요
5. **TypeScript 타입**: 매개변수와 반환값에 적절한 타입 지정
