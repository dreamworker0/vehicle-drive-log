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
├── cache.ts              ← 쿼리 결과 로컬 캐싱 헬퍼
├── dailyLogQueries.ts    ← 일별 운행일지 및 주유기록 조회 쿼리
├── driveLogs.ts          ← 운행일지 CRUD 및 보정/동기화 헬퍼
├── favorites.ts          ← 즐겨찾기 CRUD
├── feedbacks.ts          ← 피드백 CRUD 및 업데이트/삭제
├── fuelLogs.ts           ← 주유 기록 CRUD
├── hipass.ts             ← 하이패스 카드/단말기 CRUD
├── hipassCharges.ts      ← 하이패스 충전 기록 CRUD
├── holidays.ts           ← 휴일 관리 CRUD
├── maintenance.ts        ← 정비 기록 CRUD 및 차량 정비 블록 제어
├── notifications.ts      ← 알림 CRUD 및 실시간 구독
├── organizations.ts      ← 기관 신청, 승인/반려 및 초대코드 관리 CRUD
├── preRegistered.ts      ← 사전 등록 직원 목록 CRUD
├── reservations.ts       ← 예약 CRUD 및 일괄 반복예약 제어
├── superAdmin.ts         ← 시스템 관리자 전용 기능 (기관 및 유저 관리)
├── users.ts              ← 사용자 정보 조회/수정 및 소속 관리
└── vehicles.ts           ← 차량 등록/수정/삭제/퇴역 CRUD
```

컴포넌트에서는 항상 `index.ts`를 통해 import합니다:

```ts
import { getVehicles, createDriveLog } from '../../lib/firestore';
```

## 함수 추가 패턴

### 새 함수를 추가할 도메인 파일 선택

| 도메인 | 파일 | 주요 함수 |
|--------|------|-----------|
| 운행일지 | `driveLogs.ts` | `createDriveLog`, `getLastVehicleEndKm`, `getLastVehicleDriveLog`, `getDriveLogs`, `updateDriveLog`, `deleteDriveLog`, `getAdjacentDriveLogs` |
| 일일 운행 쿼리 | `dailyLogQueries.ts` | `getDriveLogsByDate`, `getFuelLogsByDate`, `getPreviousDayEndKm` (일별 집계/조회용) |
| 주유 기록 | `fuelLogs.ts` | `getFuelLogs`, `createFuelLog`, `updateFuelLog`, `deleteFuelLog` |
| 하이패스 카드 | `hipass.ts` | `getHipassCards`, `createHipassCard`, `updateHipassCard`, `deleteHipassCard` (카드/단말기) |
| 하이패스 충전 | `hipassCharges.ts` | `getAllHipassCharges`, `getHipassCharges`, `createHipassCharge`, `deleteHipassCharge` |
| 차량 | `vehicles.ts` | `getVehicles`, `createVehicle`, `updateVehicle`, `deleteVehicle`, `retireVehicle`, `restoreVehicle` |
| 예약 | `reservations.ts` | `createReservation`, `createReservationSafe`, `getReservations`, `cancelReservation`, `updateReservation` |
| 사용자 | `users.ts` | `getUser`, `createUser`, `updateUser`, `leaveOrganization`, `getOrganizationMembers` |
| 사전 등록 직원 | `preRegistered.ts` | `getPreRegisteredEmployees`, `addPreRegisteredEmployee`, `deletePreRegisteredEmployee` (가입 전 승인 관리) |
| 기관 | `organizations.ts` | `createOrganization`, `getOrganization`, `updateOrganization`, `approveOrganization`, `findOrganizationByInviteCode` |
| 정비 | `maintenance.ts` | `getMaintenanceRecords`, `createMaintenanceRecord`, `updateMaintenanceRecord`, `deleteMaintenanceRecord`, `clearVehicleMaintenanceBlock` |
| 알림 | `notifications.ts` | `createNotification`, `getNotifications`, `markNotificationRead`, `subscribeNotifications`, `deleteNotification` |
| 즐겨찾기 | `favorites.ts` | `getFavorites`, `createFavorite`, `deleteFavorite` |
| 피드백 | `feedbacks.ts` | `createFeedback`, `getAllFeedbacks`, `updateFeedback`, `deleteFeedback` |
| 휴일 | `holidays.ts` | `getCustomHolidays`, `addCustomHoliday`, `deleteCustomHoliday` |
| 시스템 관리자 | `superAdmin.ts` | `getSuperAdmins`, `getUserByEmail`, `addSuperAdmin`, `removeSuperAdmin` |

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
