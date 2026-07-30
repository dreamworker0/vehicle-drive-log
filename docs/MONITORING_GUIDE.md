# 운영 모니터링 가이드

## 1. Firestore TTL 정책 설정 (Rate Limit 자동 정리)

현재 `cleanupRateLimits` 스케줄러가 매일 05:00에 만료 문서를 삭제하고 있음.
Firestore TTL 정책을 설정하면 이 스케줄러를 **제거하고 자동 삭제**로 전환 가능.

### 설정 방법
1. [GCP Console](https://console.cloud.google.com/firestore) → Firestore
2. 좌측 메뉴 → **TTL (Time-to-Live)** 선택
3. **정책 만들기** 클릭
4. 설정:
   - 컬렉션 그룹: `_rateLimits`
   - TTL 필드: `expiresAt`
5. **만들기** 클릭

> TTL 활성화 후 `index.ts`에서 `cleanupRateLimits` export를 제거하고 재배포하면 됨.

### ⚠️ 배포 후 필수 작업 — `auditLogs` TTL 정책

접속기록(변경 로그)은 고시 「개인정보의 안전성 확보조치 기준」 제16조에 따라 **1년 보관**한다.
트리거가 `expiresAt`(= 기록 시각 + 365일)을 채우지만, **TTL 정책을 설정하지 않으면 문서가
영구히 쌓인다** — 보관기간 경과분을 파기하지 않는 것 자체가 최소보관 원칙 위반이다.

위 절차와 동일하게 설정한다.
- 컬렉션 그룹: `auditLogs`
- TTL 필드: `expiresAt`

설정 후 GCP Console의 TTL 목록에서 상태가 "제공 중"으로 바뀌는지 확인한다(수 분 소요).

### 감사 로그 기록 실패 알림 (필수)

접속기록은 법정 기록이므로 손실이 조용히 지나가면 안 된다. `auditLog` 트리거는 실패 시
`log('ERROR', 'auditLog', ...)`로 Sentry에 올린 뒤 다시 throw해 재전달을 받는다.
**재시도까지 실패하면 그 기록은 영구 손실**이므로 별도 알림을 걸어 둔다.

Cloud Logging 필터:

```
resource.type="cloud_function"
resource.labels.function_name=~"^audit(DriveLog|User)"
severity>=ERROR
```

- 빈도: **1시간 내 1건 이상** → 알림 발송 (재시도가 흡수하는 일시 오류까지 즉시 깨우지 않기 위함)
- 대응: 원본 문서(`targetType`/`targetId`)를 확인하고, 손실된 기록은 수동 보정 여부를 판단한다.

---

## 2. Cloud Monitoring 대시보드

### Google Cloud Console에서 설정
1. [Cloud Monitoring](https://console.cloud.google.com/monitoring) 접속
2. **대시보드** → **대시보드 만들기** 클릭
3. 아래 차트를 추가:

| 차트 | 메트릭 | 필터 |
|------|--------|------|
| 실행 횟수 | `cloudfunctions.googleapis.com/function/execution_count` | `status = "error"` |
| 실행 시간 | `cloudfunctions.googleapis.com/function/execution_times` | (없음) |
| 활성 인스턴스 | `cloudfunctions.googleapis.com/function/active_instances` | (없음) |

### 추천 위젯 구성
```
── 1행 ──
[ 총 실행 횟수 (라인) ] [ 에러 횟수 (라인, 빨강) ]

── 2행 ──
[ 평균 실행 시간 (라인) ] [ 활성 인스턴스 (라인) ]
```

### Cloud Functions 모니터링
1. [GCP Console](https://console.cloud.google.com/functions) → Cloud Functions
2. 각 함수 클릭 → **로그** / **메트릭** 탭 확인
3. 주요 지표:
   - **호출 횟수**: 비정상적 급증 감지
   - **에러율**: 5xx 에러 비율
   - **실행 시간**: 평균/P95 지연 시간
   - **메모리 사용량**: 한도 초과 여부

### Cloud Logging 필터
```
resource.type="cloud_function"
resource.labels.function_name="tmapProxy"
severity>=WARNING
```

---

## 3. 알림 정책 (Alerting Policy)

### 필수 알림 3개

#### (1) 높은 에러율
- **조건**: `execution_count(status=error)` / `execution_count(total)` > **5%** (5분 윈도우)
- **심각도**: Critical
- **알림 채널**: 이메일 + Slack (선택)

#### (2) 높은 지연 시간
- **조건**: p95 `execution_times` > **10초** (5분 윈도우)
- **심각도**: Warning
- **대상 함수**: `reservationTriggers`, `archiveDriveLogs`, `sendNotification`

#### (3) 함수 크래시
- **조건**: `execution_count(status=crash)` > **0** (1분 윈도우)
- **심각도**: Critical

### 설정 방법
1. **모니터링** → **알림** → **정책 만들기**
2. 조건 추가 → 위 메트릭/임계값 입력
3. 알림 채널 설정 (이메일 필수, Slack Webhook 선택)
4. 문서 추가: 담당자 연락처, 대응 절차 링크

---

## 4. 로그 기반 모니터링

### 에러 로그 알림
```
resource.type="cloud_function"
severity>=ERROR
```

### Cloud Logging → 알림 만들기
1. [Logs Explorer](https://console.cloud.google.com/logs) 접속
2. 위 필터 입력 → **알림 만들기** 클릭
3. 빈도: **5분 내 1건 이상** → 알림 발송

---

## 5. Firestore 사용량 모니터링
1. [GCP Console](https://console.cloud.google.com/firestore) → Firestore → **사용량** 탭
2. 주요 지표:
   - 일간 읽기/쓰기/삭제 수
   - 저장 용량 추이
   - 인덱스별 저장 크기

---

## 6. 비용 모니터링

1. **결제** → **예산 및 알림** → **예산 만들기**
2. 월 예산 설정 (예: ₩50,000)
3. 임계값: 50%, 80%, 100%에서 이메일 알림

---

## 7. 비용 최적화 체크리스트

| 주기 | 확인 항목 |
|---|---|
| 주간 | Cloud Functions 에러율 확인 |
| 월간 | Firestore 읽기/쓰기 추이 확인 |
| 월간 | GCS 아카이브 용량 확인 |
| 분기 | 미사용 인덱스 검토 (인덱스 탭 → 쿼리 히트 수) |

---

## 8. CLI로 빠른 확인

```bash
# 최근 에러 로그 확인
gcloud functions logs read --min-log-level=ERROR --limit=20

# 특정 함수 로그
gcloud functions logs read archiveDriveLogs --limit=50

# 함수 상태 확인
gcloud functions list --format="table(name,status,runtime)"
```

> **참고**: 프로젝트 내 `/logs` 슬래시 커맨드로도 Cloud Functions 로그를 빠르게 확인할 수 있다.
