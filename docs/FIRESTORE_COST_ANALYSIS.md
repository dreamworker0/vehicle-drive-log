# Firestore 비용 분석

> 최종 분석일: 2026-03-21 · 스케줄·TTL·인덱스 수 갱신: 2026-07-04

## 1. 복합 인덱스 ↔ 쿼리 매핑

> 2026-07-04 기준 `firestore.indexes.json`의 복합 인덱스는 **총 25개**다. 아래 표는 2026-03 스냅샷(22개)이므로
> 신규 3개를 포함한 정확한 매핑·미사용 판정은 GCP Console → Firestore → 인덱스 탭의 실제 히트 수로 재검증이 필요하다.

### ✅ 사용 중인 인덱스 (2026-03 기준 16개)

| # | 컬렉션 | 필드 | 사용 위치 |
|---|---|---|---|
| 1 | driveLogs | driverUid + orgId + vehicleId + timestamp | `driveLogs.ts` 중복 검사 쿼리 |
| 2 | driveLogs | driverUid + timestamp(desc) | `driveLogs.ts` 운전자별 일지 조회 |
| 3 | driveLogs | orgId + createdAt | `driveLogs.ts` 기관별 최근 생성순 |
| 4 | driveLogs | orgId + timestamp(desc) | `driveLogs.ts` 기관별 일지 조회 |
| 5 | driveLogs | orgId + vehicleId + timestamp | `driveLogs.ts` 차량별 일지 조회 |
| 6 | driveLogs | vehicleId + timestamp(desc) | `driveLogs.ts` 차량 운행 이력 |
| 7 | favorites | userId + createdAt(desc) | `favorites.ts` 즐겨찾기 목록 |
| 8 | fuelLogs | orgId + date(desc) | `fuelLogs.ts` 기관별 주유 기록 |
| 9 | fuelLogs | orgId + vehicleId + date(desc) | `fuelLogs.ts` 차량별 주유 기록 |
| 10 | maintenanceRecords | orgId + date(desc) | `maintenance.ts` 기관별 정비 기록 |
| 11 | maintenanceRecords | orgId + vehicleId + date(desc) | `maintenance.ts` 차량별 정비 기록 |
| 12 | notifications | targetUid + createdAt(desc) | `notifications.ts` 알림 목록 |
| 13 | notifications | targetUid + read + createdAt(desc) | `notifications.ts` 안읽은 알림 |
| 14 | organizations | inviteCode + status | `organizations.ts` 초대코드 조회 |
| 15 | organizations | status + createdAt(desc) | `organizations.ts` 상태별 기관 목록 |
| 16 | vehicles | orgId + createdAt(desc) | `vehicles.ts` 기관별 차량 목록 |

### ⚠️ 사용 여부 불명확 인덱스 (4개)

| # | 컬렉션 | 필드 | 비고 |
|---|---|---|---|
| 17 | organizations | status + deletedAt(desc) | 삭제된 기관 목록 — `organizations.ts`에서 사용 |
| 18 | reservations | date + status + startTime | `reservations.ts`에서 날짜별 예약 조회 시 사용 가능 |
| 19 | reservations | vehicleId + date | `reservations.ts` 차량별 예약 조회 |
| 20 | fuelLogs | date + fuelCost | 통계 쿼리용으로 보이나, 직접 사용하는 코드 미확인 |

### ❌ 미사용 가능성 높은 인덱스 (2개)

| # | 컬렉션 | 필드 | 제거 권장 사유 |
|---|---|---|---|
| 21 | hipassCharges | date + chargeAmount | 통계 집계용으로 추가된 것으로 보이나, 현재 코드에서 이 조합의 쿼리 미발견 |
| 22 | hipassCharges | cardId + orgId + createdAt(desc) | `hipassCharges.ts`에서 orgId + cardId + orderBy('createdAt') 쿼리 존재, 필드 순서가 다를 수 있어 확인 필요 |

> [!TIP]
> 인덱스 #21은 GCP Console → Firestore → 인덱스 탭에서 실제 쿼리 히트 수를 확인한 후 제거 결정

---

## 2. 스케줄러 비용 영향 (2026-07-04 갱신)

개별 스케줄러들이 **야간/월간 배치 2개로 통합**되고, 상시 함수는 평일·근무시간으로 축소되었다.

| 함수 | 주기 | Firestore 접근 | 비용 영향 |
|---|---|---|---|
| `dailyNightlyBatch` | 매일 02:00 KST | 백업 export + 아카이빙 + 퍼지 + 이미지 정리 통합 | **고정** — 야간 트래픽 없는 시간대 |
| `monthlyBatch` | 매월 1일 06:00 | 공휴일 동기화 + 마일리지 검증 | **최소** |
| `reservationReminder` | 평일 08~18시 매시 | 예약 + 운행일지 읽기 (OCR 워밍업 편승) | **중간** — 예약 건수에 비례 |
| `syncCalendarToApp` | 평일 06~22시 매시 | 예약 읽기/쓰기 | **중간** — 캘린더 연동 기관 수에 비례 |
| `sendInactiveOrgAlimtalkScheduled` | 평일 14:00 | 기관 활동 조회 | **최소** |

> 과거의 `warmupOcr`(5분)·`cleanupRateLimits`(매일)·개별 `archiveDriveLogs`/`backupFirestore` 스케줄은 제거·통합되었다.

---

## 3. `_rateLimits` 컬렉션 관리

- Rate Limit 윈도우: 60초~3600초 → 대부분 1시간 이내 만료
- **Firestore TTL 정책 적용 완료** (2026-07-04 확인): 컬렉션 그룹 `_rateLimits`, 필드 `expiresAt`, 만료 오프셋 0초, 상태 "제공 중"
- 이에 따라 별도 정리 스케줄러(`cleanupRateLimits`)는 제거되었고, 만료 문서는 TTL로 자동 삭제된다

---

## 4. 최적화 권장사항

### 완료됨
1. ~~**`_rateLimits` TTL 정책 적용**~~ → 완료 (2026-07-04, §3 참조). `cleanupRateLimits` 스케줄러 제거됨
2. ~~**`reservationReminder` 주기 조정**~~ → 완료. 5분 → 평일 근무시간 매시(1시간)로 축소, OCR 워밍업도 이 cron에 편승

### 검토 대기
3. **신규 인덱스 3개 포함 25개 재검증** — GCP Console 실제 히트 수로 미사용 인덱스 판정 후 제거 (§1 참조)
4. **`archiveDriveLogs` 배치 크기** — 500건 제한은 적절, 다만 3년 이상 데이터가 많아지면 반복 실행 필요

### 장기 모니터링
5. **GCP Console → Firestore → 사용량 탭**에서 월간 읽기/쓰기/삭제 추세 확인 권장
6. **인덱스 사용量** — 미사용 인덱스는 쓰기 시마다 업데이트되므로, 제거하면 쓰기 비용도 절감
