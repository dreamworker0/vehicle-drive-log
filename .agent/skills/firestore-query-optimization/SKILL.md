---
name: firestore-query-optimization
description: 대시보드·리스트 페이지의 Firestore 쿼리 자체 최적화 — 복합 인덱스, 페이지네이션, 캐싱으로 읽기(Reads) 횟수와 응답 속도를 개선하는 패턴 가이드. 화면이 느리거나 Reads가 많을 때 참고.
---

# Firestore Query Optimization Guide

Firebase Firestore 문서 읽기(Reads) 건수에 따라 비용과 응답 속도가 크게 좌우됩니다. 데이터가 쌓일수록 성능 이슈가 발생할 수 있으므로, 새로운 데이터를 쿼리하거나 기존 조회를 수정할 때 다음 가이드를 따르세요.

## 1. 서버 사이드 데이터 필터링 적용 (가장 중요)
클라이언트 측에서 모든 데이터를 불러온 후 JavaScript `filter()`를 사용하는 것은 절대 금지됩니다. (Firebase Read 비용 폭증의 원인)
항상 **Firestore 쿼리 레벨에서 데이터를 좁혀야** 합니다.

**❌ Bad (Before)**
```typescript
// 전체 데이터를 다 가져온 후 최근 1주일 데이터만 필터링 -> 모든 문서 읽음
const snap = await getDocs(collection(db, 'reservations'));
const activeReservations = snap.docs.filter(doc => doc.data().date >= oneWeekAgo);
```

**✅ Good (After)**
```typescript
// 서버 측에서 1주일치만 질의하여 가져옴
const q = query(
  collection(db, 'reservations'),
  where('date', '>=', oneWeekAgoStr),
  where('date', '<=', todayStr)
);
const snap = await getDocs(q);
```

## 2. 필수 기간 제한 강제화
전체 내역 조회가 필요한 관리자 대시보드라 할지라도 **최대 조회 기간(예: 최근 6개월, 혹은 특정 회계 연도)을 강제**하여야 합니다.
무한정 커버리지를 가진 쿼리는 작성하지 마십시오.

## 3. 일괄 작업 시 배치(Batch) 활용
여러 개의 문서(예: 동일 날짜의 반복 예약)를 다루거나 관련 문서를 동시에 수정/삭제할 경우 `Promise.all` + 개별 다수 호출을 피하고, `writeBatch`를 사용하여 원자성과 네트워크 통신 최적화를 도모합니다.

```typescript
import { writeBatch, doc } from 'firebase/firestore';
import { db } from '../firebase';

export async function deleteReservations(ids: string[]) {
  const batch = writeBatch(db);
  ids.forEach(id => {
    const docRef = doc(db, 'reservations', id);
    batch.delete(docRef);
  });
  
  // 한 번의 네트워크 요청으로 모두 처리 (비용/속도 이점)
  await batch.commit(); 
}
```

## 4. 통계 집계 데이터 분리 (Caching)
조회수 등 집계 목적의 데이터는 원본 문서를 다 읽게 하지 마세요.
`computeDashboardStats.ts`와 같이 Cloud Function이나 배치 로직에서 주기적으로 통계를 계산하여 단일 문서(예: `stats/{orgId}`)에 캐싱하고, 클라이언트는 통계 문서를 1회 Read만 하도록 설계해야 합니다.
