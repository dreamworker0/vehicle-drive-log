---
name: add-firestore-fn
description: src/lib/firestore.js에 새 Firestore 함수를 추가하고 컴포넌트에서 사용하는 패턴 가이드
---

# Firestore 함수 추가 스킬

## firestore.js 구조

`src/lib/firestore.js`는 섹션별로 구분되어 있습니다:

```
// ========================
// 사용자 (Users)
// ========================
getUser, createUser, leaveOrganization, updateUser

// ========================
// 기관 (Organizations)
// ========================
createOrganization, getOrganization, updateOrganization, deleteOrganization,
permanentDeleteOrganization, restoreOrganization,
getPendingOrganizations, subscribePendingOrganizations,
subscribeApprovedOrganizations, subscribeRejectedOrganizations,
getRejectedOrganizations, getDeletedOrganizations, getApprovedOrganizations,
approveOrganization, rejectOrganization,
generateInviteCode, findOrganizationByInviteCode, regenerateInviteCode

// ========================
// 직원 관리
// ========================
getOrganizationMembers

// ========================
// 차량 (Vehicles)
// ========================
getVehicles, createVehicle, updateVehicle, deleteVehicle

// ========================
// 운행일지 (Drive Logs)
// ========================
createDriveLog, getLastVehicleEndKm, getVehicleEndKmBefore,
getDriveLogs, getMyDriveLogs, updateDriveLog

// ========================
// 차량 예약 (Reservations)
// ========================
createReservation, createReservationSafe,
getReservations, subscribeReservations,
cancelReservation, updateReservation, updateReservationStatus,
getTodayReservations, getWeekReservations

// ========================
// 알림 (Notifications)
// ========================
createNotification, getNotifications, markNotificationRead, subscribeNotifications

// ========================
// 즐겨찾기 (Favorites)
// ========================
getFavorites, createFavorite, deleteFavorite

// ========================
// 커스텀 휴일 (Custom Holidays)
// ========================
getCustomHolidays, addCustomHoliday, deleteCustomHoliday

// ========================
// 차량 정비 기록 (Maintenance)
// ========================
getMaintenanceRecords, createMaintenanceRecord, deleteMaintenanceRecord,
clearVehicleMaintenanceBlock,
retireVehicle, restoreVehicle, cancelVehicleReservations

// ========================
// 피드백 (Feedbacks)
// ========================
createFeedback, getAllFeedbacks, updateFeedback, subscribeFeedbacks

// ========================
// 슈퍼관리자 관리
// ========================
getSuperAdmins, getUserByEmail, addSuperAdmin, removeSuperAdmin
```

## 함수 추가 패턴

### 단순 CRUD 함수

```javascript
// 데이터 조회 (단건)
export const getItem = async (itemId) => {
    const snap = await getDoc(doc(db, 'collectionName', itemId));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
};

// 데이터 조회 (목록, 필터 포함)
export const getItems = async (orgId) => {
    const q = query(
        collection(db, 'collectionName'),
        where('organizationId', '==', orgId),
        orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// 데이터 생성
export const createItem = async (data) => {
    const docRef = await addDoc(collection(db, 'collectionName'), {
        ...data,
        createdAt: serverTimestamp(),
    });
    return docRef.id;
};

// 데이터 수정
export const updateItem = async (itemId, data) => {
    await updateDoc(doc(db, 'collectionName', itemId), data);
};

// 데이터 삭제
export const deleteItem = async (itemId) => {
    await deleteDoc(doc(db, 'collectionName', itemId));
};
```

### 실시간 구독 함수

```javascript
export const subscribeItems = (orgId, callback) => {
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

```javascript
export const callMyFunction = async (data) => {
    const fn = httpsCallable(functions, 'myFunction');
    const result = await fn(data);
    return result.data;
};
```

## 컴포넌트에서 사용

```jsx
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
    // 목록 새로고침
};
```

## 주의사항

1. **import 추가**: `firestore.js` 상단에서 필요한 Firestore SDK 함수가 이미 import되어 있는지 확인
   - 이미 import됨: `doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, addDoc, orderBy, limit, serverTimestamp, writeBatch, onSnapshot`
   - Cloud Function 호출: `getFunctions, httpsCallable` (firebase/functions에서 import)
2. **섹션 주석**: 새 기능 영역이면 `// ========================` 구분선 추가
3. **organizationId 필수**: 대부분의 쿼리에 `organizationId` 필터 포함 (멀티테넌트 구조)
4. **Firestore 인덱스**: 복합 쿼리 사용 시 `firestore.indexes.json`에 인덱스 추가 필요
