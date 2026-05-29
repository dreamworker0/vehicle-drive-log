# Implementation Plan: 차량 운행일지 PWA 서비스 개선 프로젝트

본 구현 계획서는 '차량 운행일지 PWA 서비스 개선 프로젝트'의 4대 개선 과제를 성공적으로 완수하고 검증하기 위해 수립되었습니다.
모든 과제는 에이전트 행동 헌법(AGENTS.md)의 절대 금지 규칙(D1~D19)과 보안 3대 가드([GUARD-1], [GUARD-2], [GUARD-3])를 철저히 지키며 진행됩니다.

---

## 1. 아키텍처 및 핵심 제약사항

### 1.1 에이전트 행동 헌법 준수 (AGENTS.md)
- **D9. Firestore 직접 호출 금지**: R2 온디맨드 동기화 과정에서 Firestore에 접근할 때 컴포넌트나 일반 훅에서 직접 `addDoc`, `getDocs`, `updateDoc` 등을 호출하지 않으며, 반드시 `src/lib/firestore/` 도메인 파일(예: `src/lib/firestore/calendar.ts` 등)에 정의된 함수를 import하여 사용합니다.
- **D8. 다크 모드 페어링**: 대시보드 화면에 최종 동기화 알림이나 캐싱 로딩 상태 표시 등 새로운 UI를 수정하거나 추가할 경우, 반드시 라이트/다크 모드 변형 (`dark:text-white` 등)을 페어링해야 합니다.
- **D10. organizationId 누락 금지**: 캘린더 동기화 상태나 데이터를 Firestore에서 조회할 때, 반드시 현재 사용자의 조직 ID(`organizationId`)가 필터링 쿼리에 포함되도록 설계하여 멀티테넌트 격리를 보장합니다.
- **D18/D19. 임의 실행 및 진행 금지**: 사용자 명시적 요청 외의 브라우저 서브 에이전트 구동은 금지하며, 단계별 승인을 철저히 모니터링합니다.

### 1.2 보안 자율 점검 3대 가드
- **[GUARD-1] 시크릿 평문 탐지**: 코드에 API 키, 프라이빗 키 등을 절대 하드코딩하지 않습니다.
- **[GUARD-2] 배포 전 검증**: 배포 요청 전 빌드, 린트, 테스트 패스를 철저히 수행합니다.
- **[GUARD-3] 직접 fetch 금지**: 컴포넌트나 훅에서 외부 API를 호출할 때는 `src/lib/api/`에 래퍼를 정의하여 호출합니다.

---

## 2. 4대 개선 과제 세부 설계 및 마일스톤

### Milestone 1: [R1] Tmap POI 검색 결과 클라이언트 캐시 레이어 구현
- **대상 파일**: `src/hooks/usePoiSearch.ts`
- **구현 내용**:
  1. POI 검색 결과를 클라이언트 레벨에서 기억하는 캐싱 메커니즘 도입.
  2. 세션 단위 보존을 위해 `sessionStorage`를 활용하며, 검색 키워드를 Key로 하고 API 응답 리스트를 Value로 저장.
  3. 캐시 크기가 무한히 늘어나지 않도록 최대 50개의 키워드 제한을 링 버퍼(FIFO 방식)로 관리하는 헬퍼 함수 구현.
  4. 동일한 키워드로 다시 검색할 경우 네트워크 전송을 수행하지 않고 캐싱된 값을 즉시 반환하여 RTT 단축 및 Tmap API 요금 세이브.
- **검증 시나리오**:
  - 검색창에 "강남역" 검색 -> 최초 검색 시 Proxy API 호출(네트워크 패널 확인)
  - 다시 "강남역" 검색 -> API 호출 없이 즉시 캐싱된 데이터 렌더링 확인
  - 51번째 검색 시 최초 캐싱된 1번째 검색 키워드가 올바르게 만료(FIFO)되는지 검증

### Milestone 2: [R2] Google Calendar 온디맨드 동기화 및 캘린더 트리거 고도화
- **대상 파일**: 
  - 백엔드: `functions/src/calendarSchedule.ts`, `functions/src/index.ts`, 신규 `functions/src/triggerOnDemandCalendarSync.ts`
  - 프론트엔드: 신규 `src/hooks/useCalendarSync.ts`, `src/hooks/reservationCalendar/useReservationData.ts`
- **구현 내용**:
  1. **백엔드 리팩토링 및 Callable 구현**:
     - `calendarSchedule.ts` 내의 개별 차량 동기화 비즈니스 로직을 `syncSingleVehicleCalendar` 함수로 독립 분리(DRY 원칙).
     - 신규 Callable API `triggerOnDemandCalendarSync` 구현 및 `index.ts` 등록 (D13 준수).
     - 호출 시 `request.auth` 세션 및 Custom Claims 혹은 유저 문서를 통해 호출자의 `organizationId`를 엄격 검증하여 멀티테넌트 보안 격리 집행 (D10 준수).
     - 대상 차량의 `organizationId`가 호출자의 조직과 완벽 일치하는지 교차 검증 (D10 준수).
     - 구글 API 호출 에러(403/404) 시 차량 문서(`vehicles/{vehicleId}`)의 `calendarSyncFailCount` 값을 1 누적 및 실패 시간 기록.
  2. **프론트엔드 온디맨드 및 백오프 구현**:
     - 신규 훅 `src/hooks/useCalendarSync.ts` 구현: `localStorage`에 차량별 마지막 동기화 타임스탬프(`last_calendar_sync_time_map`) 보관.
     - 대시보드 진입/렌더링 시점에 차량 목록을 조회하여 연동된 차량의 마지막 동기화가 30분 전이거나 없을 시 온디맨드 백그라운드 호출 실행.
     - 네트워크 불안정 및 일시 에러 대응을 위한 **최대 3회 Exponential Backoff 재시도** (2s -> 4s -> 8s 등 지연 대기) 훅 레벨 탑재.
     - 동기화 성공 시 타임스탬프 갱신 및 UI 예약을 즉시 리프레시하여 실시간 반영.
- **검증 시나리오**:
  - 마지막 동기화 시각을 40분 전으로 localStorage에 모킹한 뒤 예약 달력 진입 검증.
  - 백그라운드에서 즉각 동기화 Callable API가 3회 백오프 장치를 안고 기동하는지, 구글 캘린더 예약이 로컬 DB에 안전하게 업데이트 및 UI 리프레시되는지 검증.


### Milestone 3: [R3] SEO 강화를 위한 빌드 후 Sitemap/Robots 자동 생성 파이프라인
- **대상 파일**: `vite.config.ts`, `package.json`, 및 신규 빌드 포스트 스크립트(`scripts/generate-seo.ts` 또는 유사)
- **구현 내용**:
  1. `npm run build` 완료 직후, `dist/` 배포 디렉터리에 `sitemap.xml`과 `robots.txt`를 자동으로 동적 생성하는 파이프라인 수립.
  2. `/index.html`, `/apply`, `/terms`, `/privacy`, `/release-notes`, `/faq` 등 비로그인 공개 주소 목록을 명확히 정의.
  3. `sitemap.xml`에는 타겟 실도메인 주소(`https://vehicle-drive-log.web.app`)와 함께 올바른 XML 형식의 URL 노드 생성.
  4. `robots.txt`에는 모든 검색 크롤러의 접근을 허용하고 Sitemap 경로(`https://vehicle-drive-log.web.app/sitemap.xml`)를 가리키는 설정 삽입.
- **검증 시나리오**:
  - `npm run build`를 실행하여 빌드 프로세스가 끝난 후 `dist/sitemap.xml` 및 `dist/robots.txt` 파일이 정상 존재함을 확인.
  - 파일 내부를 검사하여 `https://vehicle-drive-log.web.app` 도메인이 누락 없이 명시되어 있고 구조가 유효한지 확인.

### Milestone 4: [R4] Vitest 전체 테스트 커버리지 수집 및 HTML 리포트 체계 구축
- **대상 파일**: `vitest.config.ts` 또는 `vite.config.ts`, `package.json`
- **구현 내용**:
  1. `npm run test:coverage` 실행 시 코드 커버리지 통계를 추출하기 위한 Vitest 커버리지 패키지(`@vitest/coverage-v8` 또는 `istanbul`) 적용 상태 점검.
  2. `vitest.config.ts` 설정 내 `coverage` 옵션을 튜닝하여 `reporter` 유형으로 `html`, `text`, `json` 등을 포함하도록 강제.
  3. `coverage/` 디렉터리에 정밀한 코드 사각지대(Uncovered Lines)를 확인할 수 있는 인터랙티브 HTML 리포트가 내보내지도록 유도.
- **검증 시나리오**:
  - `npm run test:coverage` 명령어를 실행하여 테스트 스위트가 에러 없이 끝나고, 최종 커버리지 리포트가 생성되는지 검증.
  - `coverage/index.html` 파일을 열었을 때 브라우저에서 볼 수 있는 인터랙티브 UI 화면이 오류 없이 표시되는지 확인.

---

## 3. 하위 에이전트 동원 및 워크플로우 전략

본 프로젝트는 독립성이 강한 4대 과제로 구성되어 있으므로, 체계적으로 **Explorer → Worker → Reviewer → Auditor**의 iteration loop를 통해 안정성을 검증합니다.
오케스트레이터인 나는 직접 코드를 수정하지 않고 오직 subagent를 지휘하여 구현을 완수합니다.

### 3.1 단계별 이행 전략
1. **분석 단계 (Explorer)**: 각 마일스톤의 대상이 되는 소스 코드를 면밀히 조사하고, 헌법 위반 소지가 없는지 사전 확인하여 안전한 개발 전략 수립.
2. **구현 단계 (Worker)**: Explorer의 전략 보고서를 기반으로 실제 코드를 수정. 수정 후 즉시 'npx tsc --noEmit', 'npm run lint', 'npm run build' 등으로 에러 여부를 검증하고, unit test를 수행.
3. **리뷰 및 챌린지 단계 (Reviewer/Challenger)**: 코드 무결성 및 성능 검토. 롤링 버퍼 및 캘린더 동기화 에러 등의 엣지 케이스를 adversarial하게 챌린지.
4. **최종 오디팅 단계 (Auditor)**: Forensic Auditor를 기동하여 헌법 준수 및 정상 동작 여부를 엄격 검증(INTEGRITY VERDICT).

### 3.2 이터레이션 가드레일
- 모든 마일스톤 게이트를 통과하기 위한 조건:
  - 린트 패스 (`npm run lint` 통과)
  - 타입 체킹 패스 (`npx tsc --noEmit` 통과)
  - 빌드 패스 (`npm run build` 통과)
  - Auditor의 **CLEAN** 판정 (가장 최우선순위. VIOLATION 발견 시 이터레이션 실패 및 롤백 후 재수행)

---

## 4. 상세 수행 일정 (Timeline)

- **Step 1**: Tmap POI 캐싱 구현 및 단위 검증 (Milestone 1)
- **Step 2**: Google Calendar 온디맨드 동기화 구현 및 연동 검증 (Milestone 2)
- **Step 3**: SEO Sitemap & Robots 자동 생성 스크립트 작성 및 빌드 연동 검증 (Milestone 3)
- **Step 4**: Vitest 커버리지 리포팅 설정 조율 및 전체 테스트 무결성 검증 (Milestone 4)
- **Step 5**: 통합 품질 검증 및 최종 Handoff 리포트 작성
