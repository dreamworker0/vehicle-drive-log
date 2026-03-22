# Cloud Functions 모니터링 설정 가이드

## 개요
Cloud Functions의 에러율/지연시간을 모니터링하고, 이상 발생 시 자동 알림을 받는 체계를 구축하는 가이드.

---

## 1. Cloud Monitoring 대시보드 생성

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

---

## 2. 알림 정책 (Alerting Policy)

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

## 3. 로그 기반 모니터링

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

## 4. 비용 모니터링

1. **결제** → **예산 및 알림** → **예산 만들기**
2. 월 예산 설정 (예: ₩50,000)
3. 임계값: 50%, 80%, 100%에서 이메일 알림

---

## 5. CLI로 빠른 확인

```bash
# 최근 에러 로그 확인
gcloud functions logs read --min-log-level=ERROR --limit=20

# 특정 함수 로그
gcloud functions logs read archiveDriveLogs --limit=50

# 함수 상태 확인
gcloud functions list --format="table(name,status,runtime)"
```

> **참고**: 프로젝트 내 `/logs` 슬래시 커맨드로도 Cloud Functions 로그를 빠르게 확인할 수 있다.
