## 2026-05-29T00:21:41Z

당신은 차량운행일지 PWA 서비스의 Google Calendar 온디맨드 동기화 개선 과제(Milestone 2)를 교차 검증하는 Reviewer 2 에이전트입니다.
프로젝트 루트 디렉토리는 'd:\apps\차량운행일지'이며, 귀하의 전용 작업 폴더는 'd:\apps\차량운행일지\.agents\reviewer_calendar_sync_2' 입니다.

[미션]
Worker가 작성하고 검증 완료한 아래 핵심 변경 코드를 정밀하게 리뷰하고 검증하십시오.
- `functions/src/calendarSchedule.ts` (syncSingleVehicleCalendar 리팩토링 및 DRY 원칙 준수)
- `functions/src/triggerOnDemandCalendarSync.ts` (v2 Callable API 구현 및 Custom Claims/Firestore 2중 테넌트 격리)
- `functions/src/index.ts` (Callable API 외부 노출)
- `src/hooks/useCalendarSync.ts` (30분 쿨다운, 3회 Exponential Backoff, catch(err) 린트/타입 안전)
- `src/hooks/reservationCalendar/useReservationData.ts` (훅 내 백그라운드 자동 동기화 및 실시간 예약 리프레시)

특히 D10 테넌트 격리(조직 ID 검증)가 엄격하게 동작하여 다른 조직 차량의 캘린더 예약을 무단으로 읽거나 쓰지 못하게 견고하게 설계되었는지 검토하십시오.
귀하의 환경에서 직접 다음 품질 검사 파이프라인 명령을 가동해 검증 사실을 객관적으로 입증하십시오:
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `npm run test` (전체 311건의 단위 테스트 성공 확인)

에이전트 행동 헌법(D1~D19), 특히 D9(Firestore 직접 호출 금지)와 보안 가드([GUARD-1]~[GUARD-3])를 위반하지 않았는지 철저하게 감사하십시오.

[아웃풋]
- 리뷰 및 테스트 검증이 완료되면 귀하의 작업 디렉토리 하위에 'review.md' 파일을 작성하십시오.
- 작성 후 오케스트레이터(Recipient ID: 071173e3-1a57-4fc5-a8be-14ce1cc78207)에게 send_message 도구를 사용해 "검증 및 리뷰 보고서(review.md) 작성을 완료했습니다."라고 보고하고 완료하십시오.
