# 🗺️ 개선 로드맵

> 30년차 시니어 관점에서 본 개선 항목들. 우선순위별로 정리.
> 작성일: 2026-03-18

---

## Phase A — 즉시 실행 (1~2일) ✅ 완료

- [x] **A-1. `getAuthHeaders()` 공통 유틸 추출** (~30분)
  - `tmap.ts`, `holidayApi.ts`에 중복 존재 → `src/lib/authFetch.ts`로 통합
- [x] **A-2. Rate Limit·크기 제한 상수 분리** (~1시간)
  - 하드코딩된 값들(`MAX_BASE64_SIZE`, Rate Limit 횟수/윈도우) → `functions/src/constants.ts`로 분리
  - 나중에 Remote Config 전환 시 이 작업이 선행되어야 함
- [x] **A-3. Firebase 예산 알림 설정** (~30분)
  - GCP Console → Budgets & alerts에서 일일 예산 설정
  - Firestore 읽기/쓰기, Cloud Functions 호출 횟수 기준
  - 코드 변경 없음, 콘솔 설정만

---

## Phase B — 이번 주 (3~5일) ✅ 완료

- [x] **B-1. 에러 트래킹 도입 (Sentry)** (~반나절)
  - `@sentry/react` (프론트엔드, 이전 완료) + `@sentry/node` (Cloud Functions, 완료)
  - `helpers.ts`의 `log(ERROR)` + `wrapHttps/wrapHandler`에서 Sentry 자동 전송
  - Slack/이메일 알림은 Sentry 대시보드에서 Alert Rule 설정 필요 (콘솔 작업)
- [x] **B-2. Cloud Functions 에뮬레이터 통합 테스트** (~1~2일)
  - 대상: `joinOrganization`, `setCustomClaims`, `tmapProxy`
  - Firebase 에뮬레이터(Auth + Firestore) + Jest로 실제 읽기/쓰기 검증 (18개 케이스)
- [x] **B-3. 배포 롤백 전략 문서화** (~2시간)
  - `ROLLBACK.md` 작성 완료 (Hosting/Functions/Rules 롤백 절차 + 장애 대응 순서)
  - `firebase hosting:rollback`, Functions 이전 버전 재배포 등

---

## Phase C — 다음 주 (~2주) ✅ 완료

- [x] **C-1. 프록시 공통 프레임워크** (~반나절)
  - `createAuthenticatedProxy()` 팩토리 패턴 구현
  - `tmapProxy`, `holidayProxy` 마이그레이션 완료
  - 향후 외부 API 추가 시 보일러플레이트 자동 제거
- [x] **C-2. Firestore 비용 분석** (~반나절)
  - 인덱스 22개 ↔ 실제 쿼리 코드 매핑 → `FIRESTORE_COST_ANALYSIS.md`
  - 미사용 인덱스 2개 후보 식별, TTL 정책 적용 권장
- [x] **C-3. 아카이빙 정책 점검** (~반나절)
  - `archiveDriveLogs` 동작 분석 → `ARCHIVE_POLICY.md`
  - 3년 기준, 500건 배치, GCS JSON 저장, 복원 절차 문서화

---

## Phase D — 장기 (1~2개월)

- [ ] **D-1. 익명 인증 제거 검토** (기획 필요)
  - 기관 신청 UX에 영향 → 사용자 의견 수렴 필요
  - Google 로그인만으로 충분한지 판단
- [x] **D-2. Rate Limit 값 Remote Config 전환** (~반나절)
  - `getRateLimits()` 비동기 함수 + 5분 캐시 + 기본값 fallback 구현
  - Firebase Console에서 재배포 없이 Rate Limit 실시간 조정 가능
- [x] **D-3. CI/CD 파이프라인 구축** (~1~2일)
  - GitHub Actions: `ci.yml` (Lint→Test→Build), `deploy.yml` (프로덕션 배포), `preview.yml` (PR 프리뷰)
  - Dependabot 자동 의존성 업데이트 포함

---

## 원칙

> *"코드를 더 잘 짜는 것보다, 프로덕션에서 무슨 일이 일어나고 있는지 아는 것이 10배 더 중요하다."*

한 번에 다 하지 않는다. Phase A → B → C → D 순서로 천천히.
