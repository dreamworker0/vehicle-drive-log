# 운영 모니터링 & TTL 정책 가이드

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

## 2. GCP 모니터링 대시보드

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

### 알림 설정 (선택)
1. [Cloud Monitoring](https://console.cloud.google.com/monitoring) → 알림 정책
2. **정책 만들기** → 조건:
   - 지표: `cloudfunctions.googleapis.com/function/execution_count`
   - 필터: `status="error"`
   - 임계값: 5분간 10회 이상
3. 알림 채널: 이메일 또는 Slack

### Firestore 사용량 모니터링
1. [GCP Console](https://console.cloud.google.com/firestore) → Firestore → **사용량** 탭
2. 주요 지표:
   - 일간 읽기/쓰기/삭제 수
   - 저장 용량 추이
   - 인덱스별 저장 크기

---

## 3. 비용 최적화 체크리스트

| 주기 | 확인 항목 |
|---|---|
| 주간 | Cloud Functions 에러율 확인 |
| 월간 | Firestore 읽기/쓰기 추이 확인 |
| 월간 | GCS 아카이브 용량 확인 |
| 분기 | 미사용 인덱스 검토 (인덱스 탭 → 쿼리 히트 수) |
