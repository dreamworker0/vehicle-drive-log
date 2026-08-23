# 🛠️ 운영 가이드 (OPERATIONS)

> 슈퍼관리자 및 운영 담당자를 위한 서비스 운영 매뉴얼

---

## 1. 일상 운영 체크리스트

### 매일 확인

| 항목 | 확인 방법 | 정상 기준 |
|------|----------|----------|
| Functions 에러 | `npm run health` 또는 Firebase Console → Functions → 로그 | ERROR 0건 (⚠️ 최근 로그 300줄 범위의 0건이다 — 그 구간에 로그가 없는 함수는 점검되지 않는다) |
| Firestore 백업 | Cloud Storage → `backups/firestore/YYYY-MM-DD/` | 오늘 날짜 폴더 존재 |
| Sentry 에러 | [Sentry 대시보드](https://sentry.io) | 새 이슈 없음 |

> **관련 문서** — 이 매뉴얼은 진입점이고, 세부는 아래에 있습니다.
> [모니터링·알림 정책](docs/MONITORING_GUIDE.md) · [아카이빙 정책](docs/ARCHIVE_POLICY.md) ·
> [Firestore 비용 분석](docs/FIRESTORE_COST_ANALYSIS.md) · [롤백 절차](ROLLBACK.md) ·
> [정기 점검 일정표](OPERATIONS_SCHEDULE.md) · [외부 API 폴백](docs/API_FALLBACK.md)
>
> 스케줄 함수의 생존 확인은 `npx tsx scripts/check-health-heartbeats.ts`가
> `_health/*` 하트비트를 읽어 `apiHealthCheck`의 활성 창 판정을 그대로 재현합니다(읽기 전용).

### 주간 확인

| 항목 | 확인 방법 |
|------|----------|
| Dependabot 알림 | GitHub → Security → Dependabot alerts |
| npm 보안 감사 | `npm run audit` |
| Functions 사용량 | Firebase Console → Functions → 사용량 탭 |
| Firestore 읽기/쓰기 | Firebase Console → Firestore → Usage 탭 |

---

## 2. 기관 관리 절차

### 2.1 기관 신청 승인

```
1. 슈퍼관리자 로그인 → 기관 신청 관리
2. "대기 중" 탭에서 신청 확인
3. AI 검증 결과 확인:
   - ✅ aiVerified: true → 이미 자동 승인됨
   - ⚠️ aiVerified: false → 수동 검토 필요
     → 고유번호증 사본 이미지 확인
     → 기관명 일치 여부, 문서 유형 확인
4. "승인" 클릭 → 초대 코드 자동 생성 + 이메일 발송
5. 이메일 발송 실패 시 → 수동으로 초대 코드 전달
```

### 2.2 기관 삭제

```
1. 기관 관리 → 대상 기관 → "삭제" 클릭
2. soft delete 적용 (status: 'deleted')
3. 소속 직원은 즉시 로그인 불가 (실시간 감지)
4. 30일 이내: "삭제된 기관" 탭에서 복구 가능
5. 30일 경과: autoPurgeOrgs 함수가 자동 영구 삭제
```

### 2.3 기관 복구

```
1. 기관 관리 → "삭제된 기관" 탭
2. 대상 기관 → "복구" 클릭
3. status가 'approved'로 복원
4. 소속 직원이 다시 로그인 가능
```

---

## 3. 장애 대응

### 3.1 Cloud Functions 에러 발생 시

```bash
# 최근 에러 로그 조회
npm run health

# 또는 Firebase CLI로 직접 확인
firebase functions:log --only ocrDashboard,autoVerifyDocument
```

**자주 발생하는 에러:**

| 에러 | 원인 | 조치 |
|------|------|------|
| `Gemini API quota exceeded` | AI API 일일 한도 초과 | Google Cloud Console → API 할당량 확인/증가 |
| `messaging/registration-token-not-registered` | FCM 토큰 만료 | 자동 삭제됨 (조치 불필요) |
| `EMAILJS: 401 Unauthorized` | EmailJS 키 만료 | `functions/.env`에서 키 갱신 후 `firebase deploy --only functions` |

### 3.2 외부 API 장애 시

> 자세한 내용: [API_FALLBACK.md](docs/API_FALLBACK.md)

| API | 영향 | 대응 |
|-----|------|------|
| 티맵 API | 경로 탐색 불가 (수동 입력은 가능) | 티맵 개발자센터 상태 확인 |
| 공휴일 API | 신규 공휴일 미반영 (기존 캐시는 유지) | Firestore `system/holidays` 수동 입력 |
| Google Calendar API | 예약↔캘린더 동기화 중단 | Google Cloud Console → API 상태/할당량 확인 |

### 3.3 서비스 전체 장애 시

1. [Firebase Status](https://status.firebase.google.com/) 확인
2. Firebase Console → Hosting → 최근 배포 롤백 검토
3. Sentry 대시보드에서 에러 패턴 확인
4. 필요 시 이전 버전 재배포: `firebase hosting:clone <version> live`

---

## 4. 데이터 관리

### 4.1 백업 확인

- **자동 백업**: `dailyNightlyBatch` 함수(매일 02:00 KST)의 첫 단계에서 Firestore 전체 export 실행
- **저장 위치**: **백업 전용 버킷** `vehicle-drive-log-backups`(asia-northeast3) → `backups/firestore/YYYY-MM-DD/`
  - ⚠️ **기본 버킷을 쓰면 안 된다.** Firestore 관리형 export는 데이터베이스와 **같은 위치의
    버킷만** 받는데, Firestore는 `asia-northeast3`이고 Firebase 기본 버킷
    (`vehicle-drive-log.firebasestorage.app`)은 **`us-east1`**이다. 기본 버킷으로 걸면
    `400 ... is in location us-east1. This database can only operate on buckets spanning
    location asia or asia-northeast3`로 즉시 실패한다. 버킷 위치는 생성 후 못 바꾼다.
  - 버킷 이름은 `FIRESTORE_BACKUP_BUCKET` 환경변수로 덮어쓸 수 있고, 없으면
    `{projectId}-backups`를 쓴다. 버킷이 없으면 export 전에 "백업 버킷이 없다"고
    명시적으로 실패한다(PERMISSION_DENIED로 오독되지 않게).
  - 같은 배치의 아카이빙·인증서 정리는 위치 제약이 없어 기본 버킷을 그대로 쓴다.
  - 과거 이력: 한때 `${projectId}.appspot.com`이 박혀 있었는데 이 프로젝트에는 그 버킷이
    아예 없어서 export가 `PERMISSION_DENIED`로 매일 실패했다. 그것을 기본 버킷으로
    고쳤더니 이번엔 위치 불일치가 드러났다
    ([troubleshoot-deployment §2.6](.agent/skills/troubleshoot-deployment/SKILL.md)).
- **포함 컬렉션**: **전체** (`collectionIds: []` — 특정 컬렉션 목록을 지정하지 않는다)
  - 한때 이 자리에 "organizations, users, vehicles, driveLogs, reservations, notifications" 6개가
    적혀 있었다. 실제보다 **좁게** 적힌 오기여서, 복구 시 "이 컬렉션은 백업에 없겠구나"라고
    잘못 판단할 수 있었다.
- **하루 한 번만 건다**: export 전에 오늘 폴더(`backups/firestore/YYYY-MM-DD/`)에 객체가 있는지
  보고, 있으면 건너뛴다. 배치는 같은 날 두 번 돌 수 있는데(스케줄 함수의 Pub/Sub 전달이
  at-least-once, `retryCount: 1` 재실행, 수동 재실행) 대상 경로가 날짜로 고정돼 있어 두 번째
  export가 `3 INVALID_ARGUMENT: Path already exists`로 떨어졌고, 그 실패가 매일 밤 알림으로
  나갔다(2026-08-15). 중복 사본을 만들지 않는 쪽으로 푼 것은 관리형 export가 전체 문서를 읽어
  **읽기 비용이 그대로 청구**되기 때문이다.
  - 대신 스킵할 때 **주황색 `⚠️ Cloud Functions Warning`**을 보낸다. 백업은 정상이라는 뜻이지만,
    배치가 하루 두 번 돌았다는 신호이므로 조용히 넘기지 않는다. 원인은 대개 1차 실행이 OOM이나
    타임아웃으로 죽은 것이다([troubleshoot-deployment §2.8](.agent/skills/troubleshoot-deployment/SKILL.md)).
    빨간 `🚨 Cloud Functions Exception`과 달리 **즉시 조치가 필요한 장애는 아니다.**
- **실패 시**: 백업 스텝이 실패하면 `captureError`가 Sentry·Discord로 알린다. `PERMISSION_DENIED`면
  알림 본문에 원인 판정(IAM)과 조치 명령이 함께 실린다(`describeExportFailure`).
  - ⚠️ **알림이 없다고 백업이 있는 것은 아니다.** 코드는 export를 걸고 "시작됨"만 남긴 뒤 끝난다
    (장기 실행 작업의 완료를 기다리지 않는다). 작업이 시작된 **뒤** 실패하면 아무 알림도 나가지
    않는다. 그래서 **오늘 폴더가 비어 있으면** 두 가지가 모두 가능하다 — 배치가 안 돌았거나,
    걸린 export가 나중에 실패했거나. 함수 로그에 `Firestore backup started`가 있으면 후자다.

```bash
# Firebase Console에서 확인
# Cloud Storage → 버킷 → backups/firestore/ 폴더
```

### 4.2 데이터 아카이빙

- `dailyNightlyBatch` 함수(매일 02:00 KST)의 아카이빙 단계에서 실행
- 3년 이상 된 운행 기록 → Cloud Storage로 이동 후 Firestore에서 삭제
- 아카이빙된 데이터 위치: Cloud Storage → `archives/driveLogs/`

### 4.3 데이터 복구 (수동)

Firestore 백업에서 복구가 필요한 경우:

1. Cloud Storage에서 해당 날짜의 백업 JSON 다운로드
2. Firebase Console → Firestore → 수동으로 문서 생성
3. 또는 Firebase Admin SDK 스크립트로 일괄 복원

---

## 5. 보안 관리

### 5.1 환경변수 갱신

| 키 | 갱신 주기 | 갱신 방법 |
|----|----------|----------|
| `GEMINI_API_KEY` | API 키 변경 시 | `functions/.env` 수정 → `firebase deploy --only functions` |
| `EMAILJS_*` | 키 만료 시 | EmailJS 대시보드에서 재발급 → `.env` 수정 |
| `VITE_TMAP_API_KEY` | 키 만료 시 | 티맵 개발자센터에서 재발급 → `.env` 수정 → 빌드+배포 (⚠️ 이름이 `..._APP_KEY`가 아니다 — 틀리면 경로 탐색이 **에러 없이** 죽는다) |
| `VITE_SENTRY_DSN` | 프로젝트 변경 시 | Sentry 대시보드 → `.env` 수정 → 빌드+배포 |

### 5.2 Firebase 보안 규칙

```bash
# 현재 규칙 확인
cat firestore.rules
cat storage.rules

# 규칙만 배포
firebase deploy --only firestore:rules,storage
```

**핵심 원칙:**
- 슈퍼관리자: 모든 organizations 읽기/쓰기
- 기관관리자: 자기 기관 데이터만
- 직원: 자기 기관 읽기, 자기 기록만 쓰기
- 기관 간 데이터 완전 격리 (`organizationId` 기반)

### 5.3 캘린더 ID ↔ 기관 바인딩 (1회 시딩 필요)

캘린더 동기화는 모든 기관이 **같은 서비스 계정**에 자기 캘린더를 공유하는 구조다. 그래서 차량의
`googleCalendarId`(관리자 자유 입력)에 남의 캘린더 ID를 적으면 그 기관의 일정이 우리 예약으로
유입되고, 우리가 그 예약을 지우면 원본 일정이 지워졌다([2026-08-23 감사 발견 1](docs/security-reports/2026-08-23.md)).

이제 `calendarBindings` 컬렉션이 "이 캘린더는 어느 기관 것인가"의 정본이고, 서버가 캘린더 API를
호출하기 전에 대조한다. **미등록 ID는 처음 쓰는 기관이 선점하므로, 이미 연동 중인 기관의 현재
상태를 배포 직후 1회 굳혀야 한다:**

```bash
# 먼저 변경 없이 대상 확인 (권장)
npx tsx scripts/seed-calendar-bindings.ts --dry-run

# 실제 등록
npx tsx scripts/seed-calendar-bindings.ts
```

- 한 캘린더를 **둘 이상의 기관**이 가리키고 있으면 스크립트가 등록하지 않고 목록으로 남긴다.
  정당한 소유 기관을 확인한 뒤 `calendarBindings` 문서를 만들고, 잘못 등록된 차량의 캘린더 ID를
  비운다. (진행 중인 유출의 흔적일 수 있으므로 반드시 확인할 것)
- 기관이 캘린더를 정당하게 교체했는데 옛 ID의 바인딩이 남아 다른 기관의 등록을 막는 경우,
  Firebase Console에서 해당 `calendarBindings` 문서를 삭제하면 다시 선점 가능해진다.
- 동기화가 조용히 멈춘 차량이 있으면 Cloud Logging에서
  `"다른 기관에 귀속된 캘린더 ID"`로 검색한다(디스코드에도 경고가 1회 올라온다).

**잘못 입력된 캘린더 ID 정리** — 시딩이 두 종류의 오입력을 보고한다:

| 유형 | 뜻 | 조치 | 위험 |
|---|---|---|---|
| 공유 대상 서비스 계정 주소 | FAQ의 "이 주소와 공유하세요"를 ID 칸에 붙여 넣은 것. 여러 기관이 같은 곳을 가리키게 된다 | 비움 | 서버가 이미 거절(`*.gserviceaccount.com`) — 없음 |
| 캘린더 화면 URL | `?src=…%40group.calendar.google.com`처럼 **URL 안에 진짜 ID가 인코딩돼 있다** | **고침**(URL에서 ID 추출) | 동기화가 건너뜀 — 없음 |
| 그 밖의 값 | `/r/month/2026/8/1`처럼 캘린더 ID가 아예 없는 URL·문자열 | 비움 | 동기화가 건너뜀 — 없음 |

셋 다 보안 위험은 서버 가드로 닫혀 있으나, 값이 남아 있으면 관리자 화면에 **'연동됨'으로 보이고
'동기화 실패' 배지가 계속 붙어** 기관이 무엇을 고쳐야 할지 알 수 없다. 아래로 정리한다:

```bash
# 대상 조회 (쓰기 없음 — 기본 동작). 차량별로 '고칠 값' / '비운다'를 표시한다
npx tsx scripts/clear-invalid-calendar-ids.ts

# 확인 후 적용 (캘린더 ID 수정·비움 + 누적 실패 카운터 초기화)
npx tsx scripts/clear-invalid-calendar-ids.ts --apply

# 유형별로 나눠서 적용하려면
npx tsx scripts/clear-invalid-calendar-ids.ts --apply --only=url
```

**URL에서 ID를 뽑는 규칙은 보수적이다** — 구글 캘린더 호스트가 아니거나 ID 모양이 아니면
고치지 않고 비운다(`scripts/lib/calendarIdFromUrl.ts`, 회귀 테스트
`scripts/__tests__/calendarIdFromUrl.test.ts`). 잘못 뽑은 값을 심으면 그 기관이 남의 캘린더를
가리키게 되므로, 애초에 만들지 않는 쪽을 택했다.

비운 차량이 있는 기관에는 안내한다 — "서비스 계정 주소는 캘린더 **공유** 대상에만 넣고,
차량의 **캘린더 ID** 칸에는 구글 캘린더 설정 → 캘린더 통합의 *캘린더 ID*를 넣어주세요."
고친 차량은 다음 동기화에서 자동으로 바인딩이 선점 등록된다(캘린더를 서비스 계정과 공유해
두었다면 그때부터 정상 동작한다).

---

## 6. 모니터링 도구

| 도구 | 대상 | URL |
|------|------|-----|
| Firebase Console | Firestore, Auth, Functions, Hosting | [console.firebase.google.com](https://console.firebase.google.com) |
| Sentry | 프론트엔드 런타임 에러 | Sentry 프로젝트 대시보드 |
| GitHub Actions | CI/CD 파이프라인 상태 | GitHub → Actions 탭 |
| Cloud Storage | 백업 데이터 | Firebase Console → Storage |

### 6.1 TMAP 캐시 적중률 확인

메신저 봇이 예약 종료 시간을 자동 계산할 때 쓰는 TMAP 호출은 2단 캐시(인스턴스 메모리 → Firestore `tmapCache`)를 탄다. **캐시가 실제로 값을 하는지는 추정 1회마다 남는 로그로 집계한다.** 인스턴스 메모리 카운터는 인스턴스가 재활용되면 사라지고, 그 재활용 빈도가 애초에 알고 싶은 값이라 쓸 수 없다.

Cloud Logging(Firebase Console → Functions → 로그, 또는 Logs Explorer)에서:

```
jsonPayload.function="routeEstimate"
```

각 로그의 필드가 그 호출이 어디서 답을 받았는지 말한다.

| 필드 | 값 | 뜻 |
|---|---|---|
| `origin` | `coord` | 기관 문서의 `lat`/`lng`를 써서 출발지 조회를 아예 건너뜀 (정상 상태) |
| | `l1` / `l2` / `api` | 좌표가 없는 기관이라 주소로 조회 — 각각 메모리·Firestore·TMAP |
| `destination` | `l1` / `l2` / `api` | 목적지 좌표를 받은 곳 |
| `route` | `l1` / `l2` / `api` | 경로 소요시간을 받은 곳 |
| `tmapCalls` | 숫자 | **그 추정이 실제로 쓴 TMAP 호출 수.** 이 값의 평균이 절감 효과다 |

보는 법:
- `route`·`destination`이 `api`인 비율이 곧 미스율이다. 캐시가 없다면 추정마다 `tmapCalls`가 3(좌표 없는 기관은 지오코딩 폴백까지 4)이다.
- **`l2` 비율이 L2의 존재 가치다.** 이 값이 0에 가깝다면 인스턴스가 계속 웜이라는 뜻이므로 L2를 걷어내도 된다. 반대로 높다면 콜드 스타트가 잦아 L2가 실제로 사이를 잇고 있다.
- `origin`이 `coord`가 아닌 기관이 보이면 그 기관에 좌표가 없다는 신호다 — `backfillOrgCoords` 콜러블로 채운다.

주소·목적지 문자열은 로그에 남기지 않는다(기관 주소·방문지는 개인정보에 준해 다룬다). 그래서 "어느 기관이 미스를 내는지"는 이 로그로 알 수 없고, 분포만 본다.

### 6.2 어시스턴트 차량 목록 캐시 적중률

봇은 메시지 한 통마다 기관의 차량 목록이 필요하다(차량 이름으로 의도를 파싱한다). 그래서 차량 N대면 메시지 1건에 N 읽기가 나가던 자리에 2단 캐시(인스턴스 메모리 → Firestore `assistantVehicleCache`, TTL 5분)를 두었다. 같은 방식으로 호출마다 로그 한 줄을 남긴다:

```
jsonPayload.function="assistantVehicleCache"
```

| 필드 | 값 | 뜻 |
|---|---|---|
| `source` | `l1` | 인스턴스 메모리 적중 — 읽기 0 |
| | `l2` | 캐시 문서 1건만 읽음 (차량 N대 대신) |
| | `query` | 캐시 미스 — 차량 컬렉션을 실제로 읽음(N 읽기) |
| `count` | 숫자 | 그 목록의 차량 수 |

보는 법: `query` 비율 × 평균 `count`가 남아 있는 읽기다. `query`가 계속 높다면 TTL(5분)이 대화 간격보다 짧다는 뜻이므로 늘릴지 검토한다. 반대로 **차량 등록·정비 등록이 봇에 반영되기까지 최대 5분이 걸린다** — 이 지연이 문제가 되면 TTL을 줄인다. 오래된 목록으로 예약이 새지는 않는다. 예약 생성 트랜잭션이 차량 문서를 다시 읽어 퇴역·정비·사용 제한을 재검증한다.

---

## 7. 유용한 명령어 모음

```bash
# 개발 서버 실행
npm run dev

# 전체 배포
fnm use 22 && npm run build && firebase deploy

# Functions만 배포
firebase deploy --only functions

# 보안 규칙만 배포
firebase deploy --only firestore:rules,storage

# Functions 로그 확인
firebase functions:log -n 50

# 보안 감사
npm run audit

# Functions 상태 점검
npm run health

# 단위 테스트
npm test

# E2E 테스트
npm run test:e2e
```
