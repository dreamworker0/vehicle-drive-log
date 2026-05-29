## 2026-05-29T08:59:49Z

당신은 차량운행일지 PWA 서비스의 Google Calendar 온디맨드 동기화 개선 과제(Milestone 2)를 직접 구현하는 Worker 에이전트입니다.
프로젝트 루트 디렉토리는 'd:\apps\차량운행일지'이며, 귀하의 전용 작업 폴더는 'd:\apps\차량운행일지\.agents\worker_calendar_sync' 입니다.

[MANDATORY INTEGRITY WARNING]
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

[미션 및 상세 지침]
아래 수립된 구체적이고 안전한 아키텍처 설계를 기반으로 백엔드 및 프론트엔드 구현을 완수하십시오.

1. **백엔드 리팩토링 및 Callable API 구현** (`functions/src/`)
   - `functions/src/calendarSchedule.ts` 내의 개별 차량 동기화 로직을 `syncSingleVehicleCalendar(vehicleId: string, vehicleData: any)` 형태의 독립된 함수로 분리 추출하십시오.
     - 이 함수는 구글 캘린더 이벤트 리스트를 조회하고, Firestore reservations 컬렉션과 예약 비교/생성/수정/취소를 정밀하게 집행해야 합니다.
     - 기존 `syncCalendarToApp` 스케줄러에서도 차량 순회 시 이 `syncSingleVehicleCalendar` 함수를 호출하여 중복 없이 작동하도록 리팩토링하십시오 (DRY 원칙).
   - 신규 Callable API 파일 `functions/src/triggerOnDemandCalendarSync.ts`를 작성하십시오.
     - v2 HTTPS Callable function (`onCall`)로 구성하십시오.
     - 매개변수로 `vehicleId`와 `organizationId`를 전달받아야 합니다.
     - **보안 검증 (D10 격리)**:
       - `request.auth`가 미정의된 경우 `unauthenticated` 에러를 반환하십시오.
       - 호출자의 Custom Claims (`request.auth.token.organizationId` 또는 `orgId`)를 확인하고, 없으면 Firestore `users/{uid}` 문서에서 `organizationId`를 확인하여 요청의 `organizationId`와 완벽히 일치하는지 검증하십시오.
       - `vehicles/{vehicleId}` 문서를 조회하여 차량이 실제로 해당 `organizationId`에 속해 있는지 더블 검증하십시오.
     - 모든 검증 통과 시 `syncSingleVehicleCalendar`를 호출하고 성공 개수 통계를 반환하십시오.
   - `functions/src/index.ts` 하단에 `triggerOnDemandCalendarSync` Callable API를 import하여 export함으로써 안전하게 외부 노출 등록하십시오 (D13 준수).

2. **프론트엔드 온디맨드 동기화 및 백오프 재시도 구현** (`src/`)
   - 신규 커스텀 훅 `src/hooks/useCalendarSync.ts`를 작성하십시오.
     - `localStorage`에 차량별 온디맨드 마지막 동기화 타임스탬프를 `{ [vehicleId]: number }` 형태로 담아 `last_calendar_sync_time_map` Key 아래 안전하게 보관하십시오.
     - 현재 시간 기준 30분(1,800,000ms) 쿨다운 체크 장치를 구현하십시오.
     - 백엔드 Callable API `triggerOnDemandCalendarSync`를 호출하는 백그라운드 트리거 함수 `syncVehicleOnDemand`를 제공하십시오.
     - 네트워크 실패나 일시적 동기화 지연 대응을 위해 **최대 3회 Exponential Backoff 재시도** (실패 시 2s -> 4s -> 8s 등 시간 지연 대기 후 재호출) 로직을 안전하게 탑재하십시오.
     - 동기화 성공 시 타임스탬프를 갱신하십시오.
   - `src/hooks/reservationCalendar/useReservationData.ts`를 수정하십시오.
     - 신규 작성한 `useCalendarSync` 훅을 내부에 통합하십시오.
     - 초기 `fetchData`를 통해 차량 목록(`vehicles`)이 로드되어 설정된 직후(혹은 `vehicles` 상태가 업데이트된 시점의 `useEffect`), `vehicles` 내 `googleCalendarId`가 활성화된 차량을 찾으십시오.
     - 30분 쿨다운을 경과한 대상 차량이 존재하면 `syncVehicleOnDemand`를 백그라운드로 온디맨드 호출하여 자동으로 동기화되게 하십시오.
     - 만약 온디맨드 동기화가 성공적으로 끝난 경우, 최신 예약을 화면에 반영하기 위해 예약 목록 리프레시 함수(`getReservationsByDateRange` 등)를 호출하여 데이터를 즉시 최신화하십시오.

3. **에이전트 행동 헌법 준수 (AGENTS.md & 보안 가드)**
   - **D9 Firestore 직접 호출 금지**: 프론트엔드 훅이나 컴포넌트 내부에서 Firebase Firestore SDK를 직접 import하여 addDoc/updateDoc 등을 조작하지 마십시오. 데이터 접근은 무조건 `src/lib/firestore/` 도메인 헬퍼 함수를 경유하십시오. (훅 내부의 httpsCallable 사용이나 localStorage 사용은 허용됩니다.)
   - **[GUARD-1] 시크릿 평문 탐지**: 코드에 API 키나 자격 증명 정보를 하드코딩하지 마십시오.
   - **[GUARD-3] 직접 fetch 금지**: 외부 API 직접 fetch/axios 호출을 차단하고 `httpsCallable`을 사용하십시오.

4. **검증 및 품질 입증**
   - 코드를 안전하게 수정 완료한 후, 프로젝트 루트 디렉토리에서 다음 품질 검사 파이프라인 명령을 순차적으로 직접 가동하여 백엔드/프론트엔드가 컴파일 및 린트 에러 없이 완벽함을 입증하십시오:
     - `npm run lint` (에러/경고 없어야 함)
     - `npx tsc --noEmit` (TypeScript 컴파일 오류 없어야 함)
     - `npm run build` (빌드가 정상 완결되어야 함)
     - `npm run test` 관련 단위 테스트 실행 (테스트 스위트 통과)
   - 만약 타입 미스매치나 테스트 코드 내부 에러 발생 시, any 타입 남용을 막고 strict 타입에 부합하도록 엄격하게 교정하십시오.

[아웃풋]
- 구현 및 모든 검증이 끝나면 귀하의 작업 디렉토리('d:\apps\차량운행일지\.agents\worker_calendar_sync') 하위에 'handoff.md'를 작성하십시오.
- handoff.md 에는 변경한 파일 목록, 수정한 로직의 요약, 그리고 가동한 검증 명령(`npm run lint`, `npx tsc`, `npm run build`, `npm run test`)들의 실제 출력 결과 및 성공 로그를 상세히 명시해 주십시오.
- 완료 후 오케스트레이터(Recipient ID: 071173e3-1a57-4fc5-a8be-14ce1cc78207)에게 send_message 도구를 사용해 "Milestone 2 구현 및 품질 검증이 완료되었습니다. handoff.md를 확인하십시오."라고 보고하십시오.
