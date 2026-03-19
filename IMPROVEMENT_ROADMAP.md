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
- [ ] **A-3. Firebase 예산 알림 설정** (~30분)
  - GCP Console → Budgets & alerts에서 일일 예산 설정
  - Firestore 읽기/쓰기, Cloud Functions 호출 횟수 기준
  - 코드 변경 없음, 콘솔 설정만

---

## Phase B — 이번 주 (3~5일)

- [ ] **B-1. 에러 트래킹 도입 (Sentry)** (~반나절)
  - `@sentry/react` + Cloud Functions용 Sentry
  - `console.error` 대신 구조화된 에러 수집 + Slack/이메일 알림
- [ ] **B-2. Cloud Functions 에뮬레이터 통합 테스트** (~1~2일)
  - 우선 대상: `joinOrganization`, `setCustomClaims`, `tmapProxy`
  - Firebase 에뮬레이터 + Vitest로 실제 Firestore 읽기/쓰기 검증
- [ ] **B-3. 배포 롤백 전략 문서화** (~2시간)
  - 워크플로우로 정리: "문제 발생 시 어떤 순서로 롤백하나?"
  - `firebase hosting:rollback`, Functions 이전 버전 재배포 등

---

## Phase C — 다음 주 (~2주)

- [ ] **C-1. 프록시 공통 프레임워크** (~반나절)
  - `createAuthenticatedProxy()` 팩토리 패턴
  - `tmapProxy`, `holidayProxy`를 먼저 마이그레이션
  - 향후 외부 API 추가 시 보일러플레이트 제거
- [ ] **C-2. Firestore 비용 분석** (~반나절)
  - GCP Console에서 실제 사용량 확인
  - 월간 통계 쿼리 인덱스 최적화 필요 여부 판단
- [ ] **C-3. 아카이빙 정책 점검** (~반나절)
  - `archiveDriveLogs` 동작 확인 (기간 기준? 용량 기준?)
  - 아카이브 데이터 조회 경로 문서화

---

## Phase D — 장기 (1~2개월)

- [ ] **D-1. 익명 인증 제거 검토** (기획 필요)
  - 기관 신청 UX에 영향 → 사용자 의견 수렴 필요
  - Google 로그인만으로 충분한지 판단
- [ ] **D-2. Rate Limit 값 Remote Config 전환** (~반나절)
  - A-2에서 상수 분리 완료 후 진행
  - 재배포 없이 실시간 조정 가능
- [ ] **D-3. CI/CD 파이프라인 구축** (~1~2일)
  - GitHub Actions: `tsc → test → deploy` 자동화
  - 수동 `/deploy` 의존 탈피, PR 머지 시 자동 배포

---

## 원칙

> *"코드를 더 잘 짜는 것보다, 프로덕션에서 무슨 일이 일어나고 있는지 아는 것이 10배 더 중요하다."*

한 번에 다 하지 않는다. Phase A → B → C → D 순서로 천천히.
