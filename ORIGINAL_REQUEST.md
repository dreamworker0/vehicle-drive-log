# Original User Request

## Initial Request — 2026-05-28T09:36:31Z

# Goal
비로그인 상태에서 서비스 도입 신청(/apply) 시 로그인 페이지로 강제 리다이렉트되는 라우팅 가드 버그를 해결합니다.

Working directory: d:\apps\차량운행일지
Integrity mode: development

## Requirements

### R1. `/apply` 경로의 로그인 필수 제한(requireAuth) 해제
- `src/App.tsx`에서 `/apply` 라우트의 `AuthGuard` 설정을 수정하거나 제거하여, 비로그인 사용자도 서비스 도입 신청 페이지 (`OrgApplicationPage`)에 바로 접근할 수 있도록 조치해야 합니다.

### R2. 로그인 유무에 따른 동적 필드 렌더링 검증
- 신청 양식 페이지에서 현재 로그인된 사용자가 있을 때는 이메일/이름이 자동으로 채워지고 읽기 전용 상태가 유지되는 반면, 로그아웃 상태(비로그인 상태)일 때는 이메일과 이름을 수동으로 입력할 수 있는지 코드가 정상 동작하는지 점검해야 합니다.

## Acceptance Criteria

### 라우팅 및 접근성
- [ ] 로그아웃 상태에서 `/apply` 주소로 직접 브라우저 접근 시 로그인 페이지로 리다이렉트되지 않고 신청 화면이 로드된다.
- [ ] 메인 화면(LandingPage)에서 "서비스 도입 신청" 버튼 클릭 시 `/apply` 페이지로 정상 이동한다.
- [ ] 신청 폼 제출 시 비로그인 사용자용 익명 제출 API(`submitOrgApplication`)가 정상 동작하여 신청이 완료된다.

## Follow-up — 2026-05-28T20:38:52+09:00

실패하는 Playwright E2E 테스트 6개를 분석하고 수정하여, 전체 테스트(npx playwright test)가 오류 없이 성공적으로 통과하도록 만듭니다.

Working directory: d:\apps\차량운행일지
Integrity mode: development

## Requirements

### R1. `/apply` (기관 사용 신청) 페이지 및 관련 기능 수정
- Playwright 테스트에서 getByPlaceholder('홍길동') 등의 엘리먼트를 찾지 못하고 타임아웃이 발생하는 원인을 규명합니다.
- `/apply` 페이지의 입력 필드 및 레이아웃이 정상적으로 렌더링되고, 필수 입력 검증 및 전화번호 자동 포맷 기능이 올바르게 동작하도록 수정합니다.
- '돌아가기' 버튼 및 약관 동의 관련 기능이 정상 작동하는지 확인하고 수정합니다.

### R2. 테스트 코드 또는 컴포넌트 마크업 정합성 유지
- 실제 프론트엔드 코드의 변경 사항이 있는 경우, 기존 접근성(Accessibility) 가이드라인 및 프로젝트 코딩 컨벤션을 준수합니다.
- 필요시 테스트 코드의 셀렉터나 대기 시간을 합리적으로 조정하되, 기능의 본질적인 검증이 누락되지 않도록 합니다.

## Acceptance Criteria

### E2E 테스트 통과
- [ ] npx playwright test 실행 시 실패했던 6개의 테스트를 포함하여 총 69개의 모든 테스트가 정상적으로 통과해야 합니다.
- [ ] 특히 e2e/accessibility.spec.ts 및 e2e/org-application.spec.ts 내의 실패 케이스들이 모두 해결되어야 합니다.

## Follow-up — 2026-05-29T08:08:18+09:00

차량운행일지 프로젝트(`d:\apps\차량운행일지`)의 식별된 리팩토링 항목들을 적용한다.
코드 아키텍처 규칙(D9 Firestore 호출 격리, D8 다크모드 페어링 등)을 준수하고, 타입 안전성과 코드 품질을 개선한다.

Working directory: d:\apps\차량운행일지
Integrity mode: development

---

## Requirements

### R1. Firestore 직접 호출 격리 (D9)
컴포넌트 및 훅 내부에서 Firebase SDK(`addDoc`, `getDocs`, `deleteDoc`, `updateDoc`, `serverTimestamp`)를 직접 호출하는 부분을 `src/lib/firestore/` 도메인 파일로 추출한다.

대상 파일:
- `src/hooks/useEmployeeManager.ts` — `preRegistered` 서브컬렉션의 addDoc/getDocs/deleteDoc/updateDoc → `src/lib/firestore/users.ts` 또는 신규 `preRegistered.ts`에 함수로 분리
- `src/components/auth/AuthGuard.tsx` — `updateDoc(doc(db, 'users', uid), ...)` → `src/lib/firestore/users.ts`의 기존 `updateUser()` 활용
- `src/components/superAdmin/OrgMapView.tsx` — `updateDoc(doc(db, 'organizations', org.id), { lat, lng })` → `src/lib/firestore/organizations.ts`에 함수 추가
- `src/components/superAdmin/dashboard/DashboardOrgTable.tsx` — 동일한 organizations updateDoc 패턴 → 동일 함수 재사용

### R2. ESLint `react-hooks/exhaustive-deps` 비활성화 제거
`eslint-disable react-hooks/exhaustive-deps` 주석이 있는 파일에서 fetch 함수를 `useCallback`으로 래핑하거나 의존성 배열을 올바르게 정리하여 주석 없이도 경고가 발생하지 않게 한다.

대상 파일:
- `src/hooks/useVehicleManager.ts` (L95)
- `src/hooks/useEmployeeManager.ts` (L72)
- `src/hooks/useHipassManager.ts` (L63)
- `src/components/employee/FavoritesManager.tsx` (L37)
- `src/hooks/useAuth.tsx` (L32) — `authReady.then()` 패턴 특성상 유지가 불가피할 경우 `eslint-disable-next-line` 한 줄 주석으로 범위 최소화

### R3. `modelSuggestions` IIFE → `useMemo` 교체
`src/hooks/useVehicleManager.ts`의 `modelSuggestions`를 즉시 실행 함수(IIFE)에서 `useMemo()`로 교체하여 렌더마다 불필요한 재계산을 방지한다.

### R4. 하드코딩 URL 상수화
`src/hooks/useEmployeeManager.ts` L94의 `https://vehicle-drive-log.web.app` URL을 `src/lib/constants.ts`로 이동한다.

### R5. 타입 캐스팅 개선 (`as unknown as`)
프로덕션 소스 코드(테스트 파일 제외)에서 `as unknown as` 이중 캐스팅 패턴을 줄인다.

우선 대상:
- `src/components/admin/VehicleManager.tsx` L157-158 — `currentBattery` 필드를 `Vehicle` 타입(`src/types/vehicle.ts`)에 추가하여 캐스팅 제거
- `src/components/common/VehicleTimelineBar.tsx` L314, L332 — `syncSource`, `routeDistance` 필드를 예약 타입에 추가하여 캐스팅 제거

### R6. `refreshUserData` 빈 함수 정리
`src/hooks/useAuth.tsx`의 `refreshUserData`가 실제 동작 없는 빈 함수임을 명시적으로 주석으로 표기하거나, 외부에서 사용되지 않는다면 인터페이스에서 제거하고 하위 호환을 위해 deprecated 처리한다.  
(테스트 파일 `useAuth.test.tsx`에서 `refreshUserData` 존재 자체를 검사하므로, 완전 제거 시 해당 테스트도 함께 수정한다.)

---

## Acceptance Criteria

### Firestore 격리 (R1)
- [ ] `src/hooks/useEmployeeManager.ts`에 Firebase SDK 직접 import (`addDoc`, `getDocs`, `deleteDoc`, `updateDoc`, `serverTimestamp`)가 없다
- [ ] `src/components/auth/AuthGuard.tsx`에 `updateDoc`, `doc` import가 없다
- [ ] `src/components/superAdmin/OrgMapView.tsx`에 `updateDoc`, `doc` import가 없다
- [ ] `src/components/superAdmin/dashboard/DashboardOrgTable.tsx`에 `updateDoc`, `doc` import가 없다
- [ ] 새로 추가된 Firestore 함수는 `src/lib/firestore/` 내 도메인 파일에 위치한다

### ESLint 정리 (R2)
- [ ] `npm run lint`가 에러 없이 통과한다
- [ ] `eslint-disable react-hooks/exhaustive-deps` 블록 주석이 소스 파일에 존재하지 않는다 (next-line 단일 예외는 허용)

### useMemo 적용 (R3)
- [ ] `useVehicleManager.ts`의 `modelSuggestions`가 `useMemo`로 래핑되어 있다

### 상수화 (R4)
- [ ] `src/lib/constants.ts`에 앱 URL 상수가 존재한다
- [ ] `useEmployeeManager.ts`가 해당 상수를 import하여 사용한다

### 타입 개선 (R5)
- [ ] `src/types/vehicle.ts`에 `currentBattery` 필드가 추가되어 있다 (optional)
- [ ] `VehicleManager.tsx` L157-158에 `as unknown as` 캐스팅이 없다

### 빌드 통과
- [ ] `npx tsc --noEmit`이 에러 없이 통과한다
- [ ] `npm run build`가 에러 없이 통과한다
- [ ] `npm test`가 에러 없이 통과한다 (기존 테스트 assertion 변경 시 사용자 확인 필요)

## Follow-up — 2026-05-29T08:47:20+09:00

이 프로젝트는 사회복지기관·비영리단체용 차량 운행일지 PWA 서비스의 비즈니스 가치 확장 및 운영 효율 극대화를 위해 Tmap POI 캐싱, 구글 캘린더 온디맨드 동기화 보완, SEO 자동화, 테스트 커버리지 고도화의 4대 개선 과제를 이행하는 프로젝트입니다.

Working directory: d:\apps\차량운행일지
Integrity mode: development

## Requirements

### R1. Tmap POI 목적지 검색 결과의 클라이언트 캐시 레이어 구현
- `src/hooks/usePoiSearch.ts` 훅 내에 Tmap POI 검색 결과를 클라이언트 레벨에서 기억하는 캐싱 메커니즘을 이식합니다.
- 동일한 키워드로 반복 검색을 요청할 시, 외부 API 호출 요청을 전송하지 않고 캐시된 최신 검색 결과를 즉각 활용하여 응답 왕복 시간(RTT)을 최소화하고 API 크레딧 자원을 절약해야 합니다.
- 브라우저 종료 전까지 유효하도록 세션 스토리지(`sessionStorage`) 혹은 인메모리 방식 등으로 데이터를 보관하며, 캐시 크기가 지나치게 커지지 않도록 최대 50개 키워드 수준의 롤링 제한을 관리합니다.

### R2. Google Calendar 양방향 동기화 지연 대응을 위한 온디맨드 동기화 및 캘린더 트리거 고도화
- Google Calendar Webhook 미연동으로 인한 2시간 동기화 주기 격차 문제를 극복하기 위해 사용자 화면 진입 시점이나 예약 대시보드 렌더링 시점에 최종 동기화 시각을 점검하고, 필요 시 백그라운드에서 즉각 동기화 함수(`syncCalendarToApp`)를 호출하는 온디맨드 동기화 장치를 마련합니다.
- 캘린더와 앱의 예약 데이터가 정합성을 유지할 수 있도록 오류 발생 시 재시도 로직을 보완합니다.

### R3. SEO 강화를 위한 빌드 후 사이트맵(Sitemap.xml) 및 Robots.txt 자동 생성 파이프라인 구축
- Vite 빌드 프로세스(`npm run build`)가 마쳐지는 시점에 `/index.html`, `/apply`, `/terms`, `/privacy`, `/release-notes`, `/faq` 등 비로그인 공개 라우트의 최신 주소 목록을 포함하는 `sitemap.xml`과 크롤러 가이드 규칙이 담긴 `robots.txt` 파일이 `dist/` 배포 디렉터리에 자동으로 생성되도록 자동화 스크립트 혹은 플러그인을 도입합니다.
- 이를 통해 수동 작업 없이도 항상 최신 사이트 구조가 검색엔진 검색 수집기에 노출되도록 보장해야 합니다.

### R4. Vitest 전체 테스트 커버리지 수집 및 시각화 리포트 체계 구축
- `npm run test:coverage` 명령어 실행 시 코드의 양적 커버리지를 HTML/JSON 등의 형식으로 정확히 수집 및 출력하여 개발팀이 테스트 사각지대(Uncovered Lines)를 한눈에 식별할 수 있도록 구성합니다.
- 빌드 결과물이나 로컬 레포지토리 내에 커버리지 통계 자료가 체계적으로 저장되도록 `vitest.config.js` 또는 관련 리포터 설정을 정밀화합니다.

## Acceptance Criteria

### R1. POI 검색 캐싱 검증
- [ ] 검색창에 특정 목적지를 1회 검색한 후, 재검색 시 네트워크 패널 상에서 Tmap Proxy API에 대한 추가 HTTP 요청이 차단되고 로컬 캐시 데이터가 렌더링되는지 검증합니다.
- [ ] 세션이 새로 시작되거나 캐시된 키워드 한도가 초과될 때 롤링 방식으로 캐시가 무결하게 제어되는지 확인합니다.

### R2. 온디맨드 동기화 검증
- [ ] 대시보드 진입 시 최종 동기화 시각 이후 일정 시간(예: 30분)이 초과된 경우, 백그라운드에서 동기화 트리거가 작동하여 구글 캘린더의 예약 변경 사항을 안전하게 로컬 DB와 병합하는지 콘솔 로그 또는 데이터를 통해 검증합니다.

### R3. SEO 아티팩트 검증
- [ ] `npm run build` 완료 후, 생성된 `dist/` 폴더 내에 정확한 도메인 주소(`https://vehicle-drive-log.web.app`)가 포함된 유효한 포맷의 `sitemap.xml` 및 `robots.txt` 파일이 존재하는지 검증합니다.

### R4. 테스트 커버리지 검증
- [ ] `npm run test:coverage` 실행 시, 콘솔 출력 및 `coverage/` 폴더 내에 정상적으로 인터랙티브 HTML 리포트(LCOV 또는 Istanbul 포맷)가 에러 없이 추출되는지 검증합니다.

## Follow-up — 2026-06-09T13:22:03+09:00

이전에 진행 중이던 '차량운행일지' 프로젝트의 전체적인 성능 최적화, 리팩토링 및 개선 작업을 이어서 진행해 주십시오.

- 작업 디렉터리: d:/apps/차량운행일지
- 현재 진행 상태:
  * 마일스톤 1 & 2 (프론트엔드 빌드/로딩 성능 최적화): 완료
  * 마일스톤 3 (Firestore 쿼리 및 비용 최적화): 완료
  * 마일스톤 4 (Cloud Functions 4계층 리팩토링 및 헬스 체크): 진행 중 (사용자 스크립트 실행 승인까지 처리된 상태)
  * 마일스톤 5 (종합 품질 및 E2E 테스트 최종 검증): 대기 중

프로젝트 루트 및 `.agents/` 디렉터리에 기록된 `ORIGINAL_REQUEST.md`, `PROJECT.md`, `progress.md`, `plan.md`, `BRIEFING.md` 파일들의 상태 및 리팩토링 이력을 확인하여, 멈췄던 마일스톤 4의 남은 단계부터 유기적으로 작업을 재개하고 완수해 주십시오.
