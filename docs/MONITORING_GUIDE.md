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
