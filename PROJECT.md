# Project: 차량 운행일지 PWA 서비스 개선 프로젝트

## Architecture
본 프로젝트는 차량 운행일지 PWA 서비스의 클라이언트 검색 성능 개선, 구글 캘린더 온디맨드 양방향 동기화 무결성 확보, 검색 엔진 최적화(SEO) 빌드 자동화 및 테스트 리포트 커버리지 가시성 체계를 수립합니다.

- **Tmap POI 캐싱**: `usePoiSearch.ts` 훅 내부에 sessionStorage 기반의 50개 FIFO 링 버퍼 캐시 레이어를 구축하여 검색어 중복 네트워크 호출을 바이패스(RTT 0ms)합니다.
- **Google Calendar 온디맨드 동기화**: `functions/src/` 백엔드 Core 리팩토링 및 v2 `onCall` Https Callable API (`triggerOnDemandCalendarSync`) 추가. 프론트엔드는 30분 쿨다운 및 실패 시 지수 백오프(`2s -> 4s -> 8s`)를 가진 `useCalendarSync` 훅과 `useReservationData` 훅을 통합합니다. D10 테넌트 격리를 완전 보장합니다.
- **SEO 자동 생성 파이프라인**: Vite 빌드 포스트 프로세스 스크립트를 구축하여 빌드 시점에 자동으로 `sitemap.xml` 및 `robots.txt`를 동적으로 스캔 및 배치 생성합니다.
- **Vitest 테스트 커버리지 고도화**: 전체 단위 테스트 코드 커버리지를 HTML/JSON 포맷으로 수집 및 가시화하도록 Vitest 설정을 고도화합니다.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Tmap POI 캐싱 | `usePoiSearch.ts` 및 단위 테스트 구현, 50개 FIFO 캐시 링 버퍼 적용 | none | DONE |
| 2 | Google Calendar 동기화 보완 | 백엔드 리팩토링 및 Callable API 구현, 프론트엔드 백오프 재시도 및 30분 쿨다운 연동 | M1 | DONE |
| 3 | SEO 자동화 | Vite 빌드 완료 후 Sitemap/Robots 자동 생성 파이프라인 연동 | M2 | DONE |
| 4 | Vitest 테스트 커버리지 고도화 | `vitest.config.js` 및 npm run test:coverage 시각화 리포트 체계 수립 | M3 | DONE |

## Interface Contracts
### usePoiSearch ↔ sessionStorage
- `poi_search_cache` 키 하위에 `{ queue: string[], data: Record<string, PoiResult[]> }` 구조로 FIFO 데이터 송수신.

### triggerOnDemandCalendarSync (Callable API)
- **Request**: `{ vehicleId: string }`
- **Response**: `{ success: boolean, syncedCount?: number, error?: string }`
- **Auth**: `request.auth.token.organizationId` (Custom Claims)와 `vehicles/{vehicleId}` 내 `organizationId` 일치 검증 필수.

## Code Layout
- `src/hooks/usePoiSearch.ts` — POI 검색 및 캐시 훅
- `src/__tests__/hooks/usePoiSearch.test.ts` — POI 캐시 유닛 테스트
- `functions/src/calendarSchedule.ts` — 스케줄러 동기화 및 단일 차량 코어 로직
- `functions/src/triggerOnDemandCalendarSync.ts` — 온디맨드 구글 캘린더 동기화 API
- `src/hooks/useCalendarSync.ts` — 30분 쿨다운 및 Exponential Backoff 재시도 훅
- `src/hooks/reservationCalendar/useReservationData.ts` — 온디맨드 훅 연동 예약 데이터 처리 레이어
- `scripts/generate-seo.ts` — 빌드 완료 후 Sitemap 및 Robots 자동 생성 스크립트
- `vitest.config.js` — 테스트 커버리지 리포트 수집 설정
- `src/__tests__/store/useThemeStore.test.ts` — 테스트 커버리지 퀄리티 게이트 패치를 위한 테마 스토어 단위 테스트
