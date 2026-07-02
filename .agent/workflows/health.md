---
description: Cloud Functions 헬스 체크 실행
---

// turbo-all

> 💡 **Health Check 목적 및 경로**
> Cloud Functions의 상태를 모니터링하기 위해 `ping` 및 `heartbeat` 엔드포인트를 호출합니다.
> 관련 로그는 GCP Console 또는 대시보드에서 API Health Check 현황으로 확인할 수 있습니다.

1. Run Cloud Functions health check:
```
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; fnm use 22; npm run health
```
Working directory: `.`

2. (선택) 스케줄러 heartbeat 진단 — `_health/{reservationReminder,syncCalendarToApp,syncHolidays}`의 lastRun과 활성 창 기준 ok/error 판정을 확인할 때:
```
npx tsx scripts/check-health-heartbeats.ts
```
Working directory: `.`
> 💡 읽기 전용 스크립트. ADC(`GOOGLE_APPLICATION_CREDENTIALS`) 인증이 필요하며, 스케줄 함수가 "돌았어야 하는데 안 돈" 상황을 apiHealthCheck와 동일 로직으로 재현·검증한다.
