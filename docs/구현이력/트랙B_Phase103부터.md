# 트랙 B — 운영 고도화 로그 (Phase 103~)

> 2026-07-19 ~ . 어시스턴트 확장·테마 렌더 경로 정리·App Check 3차 강제 구간. **새 Phase는 이 파일 끝에 append한다.**
>
> 전체 목차와 다른 구간은 [구현이력.md](../구현이력.md) 참고.

---

### Phase 103: 메신저 어시스턴트 예약 취소 intent — 본인 예약 취소·확인 버튼 🤖🚫 (푸시 완료·CI 배포)

> 2026-07-19, 조회·생성만 되던 어시스턴트에 **예약 취소**를 추가. "내일 스타렉스 예약 취소해줘" 같은 자연어로 본인 예약을 취소한다. 취소/수정 중 **취소를 먼저 완결**하고 수정은 후속(대상 특정·확인 인프라를 취소에서 만들어 수정이 재사용). 플랫폼 독립 코어라 슬랙·구글 챗 공용.

| 항목 | 내용 |
|------|------|
| **의도 추가** | `parseIntent`에 `cancel` 분류(취소 단서 날짜·차량·시작시간 추출). `qa`처럼 멀티턴 병합·생성 재검증 대상 아님 — 오케스트레이터가 후보를 특정하게 단서만 남긴다. 존재하지 않는 차량 id 무효화 |
| **후보 조회** | 신규 `services/assistant/cancelReservation` `findCancelCandidates` — **본인(reservedByUid) + 기관 스코프**로 취소 가능(pending/reserved) 후보 조회. 날짜 단서 없으면 오늘(Asia/Seoul) 이후 예정 건. 0건 안내 / 1건 확인 제안 / N건 되묻기(상태 저장 없이 시간 더해 재요청). 상한 10건 |
| **권위 코어** | 신규 `services/reservation/cancelReservationCore` `cancelReservationTx` — 트랜잭션으로 **조직 격리·소유자(reservedByUid==actorUid)·상태 가드(pending/reserved만, completed/cancelled/rejected 거부)** 재검증 후 `status='cancelled'`. 캘린더 이벤트 삭제·취소 알림은 기존 `reservationTriggers`(status→cancelled 분기)가 자동 처리 → 코어는 상태만 전이 |
| **오케스트레이터** | `handleAssistantMessage` cancel 분기(진행 예약 폐기 → 후보 조회 → 0/1/N 처리) + `executeCancelProposal`(확인 후 `cancelReservationTx` 실행, 코어 한국어 에러 그대로 전달). `AssistantResult.cancelProposal` 신설 |
| **Slack 어댑터** | `onSlackTaskCreated` — 취소 확인 버튼(`confirm_cancel`, danger 스타일) + 닫기(`cancel_reservation` 재사용) 전송, `processAction`이 `confirm_cancel`→`executeCancelProposal` 분기. `slackConfirmations`에 `kind`(create/cancel) 필드. **버튼 소유자 검증(slackUserId 일치) + 코어 소유자 체크 이중 방어**. 봇은 admin SDK라 이 검증이 유일 방어선 |
| **인프라** | 기존 복합 인덱스 `reservations(organizationId, reservedByUid, date)` 재사용(등가·범위 조회) → 새 인덱스 불필요. 내부 서비스 모듈이라 `index.ts` 등록 없음 |
| **검증** | 단위: `cancelReservationCore` 9(필수·not-found·격리·소유자·이미취소·completed거부·정상·pending·internal)·`cancelReservation`(findCancelCandidates) 7(격리·날짜등가/범위·상태필터·차량/시간 좁힘·매핑)·`parseIntent` cancel 3·`handleAssistantMessage` cancel 3 + `executeCancelProposal` 2·`onSlackTaskCreated` 2(취소 버튼·confirm_cancel 실행). functions 전체 **46 suites/442 통과**(신규 26), type-check·ESLint 0, Node 22. 커밋 `430ea15` |
| **하지 않은 것** | 예약 **수정**(modify) intent — 후속(필드별 파싱·겹침 재검사·변경 전후 요약으로 회귀 표면이 큼, 취소의 대상 특정·확인 인프라 재사용 예정). 관리자 대리 취소(본인 예약만, 대리 취소는 앱에서). N건 되묻기의 상태 저장(현재는 무상태 재요청). 프로덕션 E2E 실증은 배포 후 진행 |

### Phase 104: 메신저 어시스턴트 예약 수정 intent + README 종합 구조도 🤖✏️🗺️ (푸시 완료·CI 배포)

> 2026-07-19, Phase 103(취소)의 후속으로 **예약 수정**을 추가. "내일 스타렉스 예약을 15시로 옮겨줘" 같은 자연어로 본인 예약의 날짜·시간을 변경한다. 취소에서 만든 대상 특정(`findCancelCandidates`)·확인 인프라를 그대로 재사용해 회귀 표면을 줄였다. 함께 README에 프로그램 종합 구조도(6계층) 이미지를 추가.

| 항목 | 내용 |
|------|------|
| **의도 추가** | `parseIntent`에 `modify` 분류 — **대상 단서**(date·vehicleId·startTime = 기존 예약)와 **새 값**(newDate·newStartTime·newEndTime)을 구분 추출. `qa`/`cancel`처럼 멀티턴 병합·생성 재검증 대상 아님. 새 시간 형식 검증(TIME_RE), 대상 차량 무효화 |
| **권위 코어** | 신규 `services/reservation/modifyReservationCore` `modifyReservationTx` — 트랜잭션으로 **조직 격리·소유자·상태 가드(pending/reserved)** 재검증 + **차량 문서 락**(생성/수정 동시성) + **시간 겹침 재검사(자기 자신 제외)** 후 date/startTime/endTime 갱신. 차량 변경은 미지원(같은 차량 날짜·시간만). 캘린더 갱신·변경 알림은 기존 `reservationTriggers`(일반 수정 분기)가 자동 |
| **오케스트레이터** | `handleAssistantMessage` modify 분기 — 대상 특정(취소와 동일 후보 조회 재사용) → **새 값 계산**(제공값 우선·미제공 유지) → 확인 제안. **새 시작만 주면 원래 소요시간 유지**(shift, 자정 넘김 거부), 변경 없으면 되묻기, 과거일·시작≥종료 거부. `executeModifyProposal`(확인 후 실행). `AssistantResult.modifyProposal` 신설 |
| **Slack 어댑터** | `onSlackTaskCreated` — 변경 확인 버튼(`confirm_modify`, primary)+닫기 전송, `processAction`이 `confirm_modify`→`executeModifyProposal` 분기. `slackConfirmations.kind`(create/cancel/modify). 버튼 소유자 검증 + 코어 소유자 체크 이중 방어 |
| **README 구조도** | `docs/images/vehicle-drive-log-architecture.png`(이미 추적)를 README "시스템 구조" 섹션에 추가 — 사용자·화면·프론트엔드·Firebase·Cloud Functions·외부 서비스 6계층 종합도. 코드 기준 검증, 접근성 alt 텍스트 |
| **인프라** | 기존 `org+reservedByUid+date`(대상 후보)·`org+vehicleId+date`(겹침) 인덱스 재사용. 내부 서비스 모듈이라 `index.ts` 등록 없음 |
| **검증** | 단위: `modifyReservationCore` 11(필수·시간역전·not-found·격리·소유자·상태·차량격리·겹침·self제외·정상·internal)·`parseIntent` modify 3·`handleAssistantMessage` modify 5 + `executeModifyProposal` 2·`onSlackTaskCreated` 2. functions 전체 **47 suites/465 통과**(신규 23), type-check·ESLint 0, Node 22. 커밋 `ae372a1`(feat) |
| **하지 않은 것** | 차량 변경 수정(allowedUserIds·타 차량 겹침으로 표면 큼 → 후속), N건 되묻기 상태 저장(무상태 재요청 유지), purpose/destination 수정(저가치), 프로덕션 E2E는 배포 후 |

### Phase 105: 어시스턴트 예약 차량 변경은 앱으로 안내 (채팅 미지원 우회) 🤖🔁 (푸시 완료·CI 배포)

> 2026-07-19, Phase 104가 후속으로 남긴 "차량 변경 수정"을 검토한 결과, 차량 변경은 **캘린더 크로스무브**(예약의 `calendarEventId`가 옛 차량 Google Calendar에 붙어 있어, 차량을 바꾸면 옛 캘린더에서 삭제→새 캘린더에 생성해야 함)를 동반한다. 이는 모든 예약 수정이 지나는 **공용 동기화 트리거**(`reservationTriggers`)를 건드리는 일이라, 날짜·시간 수정과 회귀 위험 급이 다르다. 파일럿·낮은 빈도·공용 트리거 리스크를 고려해 **완전 지원 대신 "앱으로 안내" 우회**를 채택(사용자 확정). 앱은 차량 변경을 완전 지원한다.

| 항목 | 내용 |
|------|------|
| **차량 변경 감지** | `parseIntent` modify에 `newVehicleId` 추가 — "스타렉스 예약을 소나타로 바꿔줘"에서 대상의 현재 차량(vehicleId)과 **새 차량**(newVehicleId)을 구분 추출. 목록에 없는 새 차량 id는 무효화 |
| **안내 우회** | `handleAssistantMessage` modify 분기에서 대상 특정 후, `newVehicleId`가 **대상 차량과 다르면** "🔁 예약 차량 변경(A → B)은 앱에서 해주세요. 여기서는 날짜·시간 변경만" 안내 반환. **오파싱 오탐 방지**를 위해 대상과 다를 때만 우회(같으면 정상 시간 수정 진행) |
| **무변경 유지** | `modifyReservationCore`·`reservationTriggers`(공용 캘린더 동기화)는 **손대지 않음** — 저위험. 날짜·시간 변경은 그대로 지원 |
| **검증** | `parseIntent` 2(newVehicleId 추출·무효화)·`handleAssistantMessage` 2(차량 변경 안내·오탐 시 정상 진행). functions 전체 **47 suites/469 통과**(신규 4), type-check·ESLint 0, Node 22. 커밋 `4302b2d` |
| **하지 않은 것** | 차량 변경 완전 지원(캘린더 크로스무브를 트리거에서 옛 차량 삭제→새 차량 생성으로 다루는 별도 작업 필요 — 공용 동기화 트리거 회귀 표면). 프로덕션 E2E는 배포 후 |

### Phase 106: 어시스턴트 수정 되묻기 맥락 기억 + 생성 시작만 입력 시 종료 자동 🤖🧠 (푸시 완료·CI 배포)

> 2026-07-19, 프로덕션 실사용(Socialprism) 중 발견한 두 UX 결함을 개선. **(A)** "13~15시로 변경" → 후보 N건 되묻기 후 "EV52465를 적용해줘"가 **맥락을 잃고 unknown(도움말)으로 떨어짐**(Phase 104가 "N건 되묻기 무상태"로 남긴 부분). **(B)** 생성 시 시작만 말하면 종료 시간을 매번 되물음. 사용자 요청으로 둘 다 채택(차량 변경 TMAP 자동계산은 후속).

| 항목 | 내용 |
|------|------|
| **A. 되묻기 맥락 기억** | 수정 N건 되묻기 시 **새 값(newValues)+후보(candidates)를 `assistantConversations`에 저장**(`kind='modify'`, 10분 TTL). 다음 메시지를 `resolveModifySelection`으로 후보 선택 해석 — **서수("2번")·순수 숫자·차량명 부분일치·시작시각**, LLM 재파싱 없음(순수 문자열 매칭). 1건 확정 → 저장한 새 값 적용 / 여러 건(같은 차량 등) → 좁혀 재되묻기 / 0건(주제 전환) → 되묻기 폐기 후 정상 파싱 |
| **구조** | 단건 확정과 되묻기-선택 경로가 `buildModifyResult`(대상+새 값→제안/안내)를 공유(중복 제거). 대화 상태 로더를 `create`(슬롯)/`modify`(후보) **판별 유니온**으로 확장 — 기존 create 멀티턴 하위 호환(`kind` 없는 문서는 create로 해석) |
| **B. 시작만 입력 → +1시간** | `parseIntent` create에서 `startTime`만 있고 `endTime` 없으면 **+1시간 자동**(앱 `calcEndTime(start,0)`과 동일 공식, 23:59 상한). 종료를 되묻지 않고 바로 제안. 확인 버튼이 최종 안전망 |
| **오탐 방어** | 되묻기 해석이 혹시 잘못 매칭돼도 **변경 전/후 확인 버튼**으로 사용자가 닫기 가능(파괴적 아님). 차량명이 플레이트 포함(EV52465·소나타3333)이라 부분일치 신뢰도 높음 |
| **검증** | `parseIntent` +1시간 2(자동·23:59 상한)·`handleAssistantMessage` 되묻기 5(저장·차량명 선택·번호 선택·주제전환·같은차량 재되묻기). functions 전체 **47 suites/476 통과**(신규 7), type-check·ESLint 0, Node 22. 커밋 `f4c3fbe` |
| **하지 않은 것** | 목적지+TMAP 종료시간 자동계산(C — 봇에서 TMAP 지오코딩·경로 호출 + 기관주소·carType 필요한 서버 통합, 후속). 되묻기 오탐의 완전 차단(범용 차량명 + 새 명령 동시 상황 — TTL·확인버튼으로 완화). 프로덕션 E2E는 배포 후 |

### Phase 107: 어시스턴트 예약 생성 — 목적지 필수화 + TMAP 종료시간 자동계산 (+1시간 폴백 철회) 🤖🗺️ (푸시 완료·CI 배포)

> 2026-07-19, Phase 106의 "시작만 입력 시 +1시간(B)"에 대해 사용자가 **"목적지를 꼭 넣도록 유도하고, 없으면 +1시간 처리는 취소"**로 방향을 정정. 앱의 예약 흐름(목적지 입력 → 기관주소→목적지 이동시간으로 종료 자동, `useRouteInfo`+`calcEndTime`)을 어시스턴트에 재현(C). TMAP 실패 시 종료 되묻기는 사용자 확정(추천안). README에 데모 영상 링크 추가.

| 항목 | 내용 |
|------|------|
| **B 철회** | Phase 106의 "종료 미지정 시 +1시간 자동"(`parseIntent` create) 제거 — 목적지 필수 흐름과 상충 |
| **목적지 필수** | `parseIntent` create 필수를 **날짜·시작·차량·목적지**로 변경(종료는 제외). 목적지 없으면 "목적지를 알려주세요. 이동시간을 계산해 종료를 자동으로 잡아드려요" 되묻기. 멀티턴 `contributed`에 destination 추가(목적지만 답해도 이어가기). 시작≥종료 검사는 종료를 직접 준 경우만 |
| **TMAP 서비스** | 신규 `services/tmap/routeEstimate` `estimateOneWayDurationMin` — 기관주소→목적지 **지오코딩(POI 우선·`fullAddrGeo` 폴백) + 경로(`/tmap/routes`)** 로 편도 소요시간(분), 실패 시 null. `calcEndTimeFromDuration`(앱 `calcEndTime` 동형: 왕복×2+여유1h·10분 올림·23:59 상한). `TMAP_API_KEY` defineString 재사용(`tmapProxy`와 동일). 단순화(파일럿): 단일 목적지·carType='0' |
| **오케스트레이터** | `handleAssistantMessage` create — 종료 미지정이면 `getOrgAddress`(organizations.address) → `estimateOneWayDurationMin` → 종료 자동. **null이면 종료 시간 되묻기(슬롯 저장)**. 사용자가 종료를 직접 주면 TMAP 미호출. 플랫폼 독립(슬랙·구글챗 공용) |
| **README** | 상단 "지금 써보기" 줄에 ▶️ 데모 영상 링크(`youtu.be/XdT5Wm_pd3s`) 추가 |
| **검증** | `routeEstimate` 9(POI+경로 성공·지오코딩 실패·경로 실패·주소없음·빈목적지 + `calcEndTime` 4)·`parseIntent` 목적지 필수 2·`handleAssistantMessage` TMAP 3(종료 자동·실패 되묻기·직접입력 시 미호출). functions 전체 **48 suites/488 통과**(신규 12), type-check·ESLint 0, Node 22. 맥락적 수정(Phase 106) 5건 유지 확인. 커밋 `764bf4a`(feat) |
| **하지 않은 것** | 다중 경유지·차종별(carType) 통행료 반영(앱에서, 봇은 단순화), 목적지 POI 후보 되묻기(첫 매칭 사용), 프로덕션 E2E는 배포 후 |

### Phase 108: iOS Safari IndexedDB "Internal error" Sentry 노이즈 필터 🐛 (푸시 완료·CI 배포)

> 2026-07-20, Sentry `TypeError: Internal error`(iOS 18.7 Mobile Safari, `/employee/drive-log`, unhandledrejection) 보고. 스택 없는 바닥 "Internal error" 메시지로, 우리 코드는 해당 문자열을 던지지 않음(grep 0건)·Firestore 영속성 레이어가 WebKit IDB 내부 실패를 그대로 전파하는 환경 노이즈로 확진(Phase 97의 iOS IDB 노이즈와 동일 계열, 이력상 `UnknownError: Internal error opening backing store`도 같은 WebKit 버그). 코드로 해결 불가.

| 항목 | 내용 |
|------|------|
| **필터** | `src/lib/sentry.ts` `ignoreErrors`에 앵커 정규식 `/^Internal error\.?$/` 추가. 메시지가 일반적이라 부분 매칭 대신 정확 일치("Internal error"/"Internal error.")만 차단 — `Internal error opening backing store` 등 기존 항목과 겹치지 않게 좁힘. 기존 Firestore IDB 내부 노이즈(`INTERNAL ASSERTION FAILED`) 항목 옆에 배치 |
| **판단 근거** | `TypeError('Internal error')` 자체 발생원 grep 0건(억제 목록 2곳 제외), iOS Safari 단독·unhandledrejection·무스택 → WebKit IDB 시그니처. 기존 `/FirebaseError.*internal/`는 FirebaseError 접두 필요라 미매칭. Sentry `ignoreErrors`는 예외 `value`("Internal error")를 매칭 후보로 두므로 앵커 정규식이 정확히 걸림 |
| **검증** | type-check 통과 + pre-commit 훅 eslint·관련 vitest 통과. 노이즈 필터 전용(앱 로직·격리 무영향)이라 풀 빌드/E2E 생략 |
| **커밋** | `89df6ed`(fix) |
| **적용** | CI 배포 후 신규 이벤트부터. 기존 Sentry 이슈는 수동 Resolve/Ignore |

---

### Phase 109: 하네스 엔지니어링 전면 개선 — Doctor·verify 게이트·eval 26스킬·CI 재구조화 🧰 (로컬 완료·커밋 대기)

> 2026-07-20, 외부 평가(74/100)에서 지적된 하네스 갭 일괄 개선. 문서 추가가 아니라 자동 실행·회귀 차단 중심: 하네스 Doctor 신설, 배포 가드 간접 실행 차단, Functions 커버리지 게이트, eval 전 스킬 커버리지 + provenance, CI 변경 감지·아티팩트 보강.

| 항목 | 내용 |
|------|------|
| **AGENTS.md 진입점화** | 한국어 규칙 1줄뿐이던 파일을 Codex 공용 진입점으로 재작성 — `.agent/agents.md` 필수 선행 참조 + 안전 규칙 요약(멀티테넌트·배포 단일 경로·Node 22·브리지). 규칙 복제 없이 `.agent/` 단일 원본 유지 |
| **하네스 Doctor 신설** | `scripts/check-harness.ts`(`npm run verify:harness`) — 12개 영역(Node 정합·진입점 연결·스킬 frontmatter·이름 충돌·브리지 동기화·eval 커버리지·베이스라인 provenance/해시·구식 명령 패턴·개인설정 추적·깨진 상대 링크) 검사, 오류/경고 구분, exit 1 게이트. 파서 단위 테스트 13건(`scripts/__tests__/check-harness.test.ts`). 첫 실행에서 실제 결함 18건 적발(깨진 스킬 링크 11건 포함) 후 전부 해소 |
| **배포 가드 보강** | `guard-firebase-deploy.mjs`가 npm 스크립트 간접 배포(`npm run deploy`, `npm --prefix functions run deploy`, pnpm/yarn 변형)도 "ask" 강등 — allowlist `Bash(npm run *)` 우회 구멍 봉쇄. `isDeployCommand` 분리 + 단위 테스트 35건(미탐·오탐 양방향) |
| **깨진 워크플로 수정** | deploy.md의 `npm test run` 오타·PS 5.1 비호환 `&&` 체이닝 제거(→ `check:node --strict`·`verify:fast`), pre-commit.md 복구 절차를 실제 훅과 일치화(문서대로 실행 시 type-check·브리지 동기화가 소실되던 문제) |
| **CI 재구조화** | ① Functions 변경 감지에 `shared/**` 추가(faqData 공유 소스 갭) ② Functions 테스트를 병렬 잡으로 분리(체감 ~19분→~15분) + 커버리지 게이트 ③ E2E 실패 시 trace·screenshot·test-results 아티팩트 업로드(성공 시 미업로드) + 커버리지 요약 상시 업로드 ④ `harness-ci.yml` 신설 — `.md` 전용 푸시가 paths-ignore에 묻히던 `.agent/**`·훅·eval 변경을 ~3분 검사(sync·Doctor·하네스 테스트·gitignore) |
| **verify 진입점** | `verify:harness`(Doctor) / `verify:fast`(Node+lint+tsc 양쪽) / `verify:full`(전체 게이트, 외부 서비스 접근 없음) + `test:functions(:coverage)` 별칭. 기존 스크립트 전부 보존 |
| **Functions 커버리지 게이트** | `collectCoverageFrom`(전 소스, index.ts 제외) 도입 후 재실측(stmts 45.25/branches 76.5/funcs 48.59) → 안전 마진 ~2pp 하한선(43/74/46/43) 설정. CI에서 회귀 차단 |
| **eval 보강** | trigger eval 22→29케이스(누락 4스킬: analytics·hook·faq·vehicle-color + 음성 "none" 3건). 블라인드 재측정 **29/29 (claude-fable-5, 2026-07-20)**. 베이스라인에 provenance(측정일·모델·SHA·케이스수·결과해시) 필수화 + 이전 베이스라인 history 보존(덮어쓰기 방지). behavior 베이스라인은 재실행 없이 레거시 provenance(2026-06-18, 모델 unknown) 정직 기록 |
| **재현성·위생** | 추적되던 빈 개인설정 `.claude/settings.local.json` git rm --cached + gitignore. `check-node-version.ts`에 실행 환경·fnm exec·설치 안내 보강. README/CONTRIBUTING/CLAUDE.md 명령 표를 verify 체계와 일치화. Playwright CI trace(`retain-on-failure`) 활성화 |
| **플레이키 격리 수정** | `src/__tests__/lib/firestore.test.ts` — 커버리지+병렬 부하에서 1번 테스트의 `captureError` 호출이 2번 테스트 구간으로 새던 간섭(로그로 확인: 2번 실패 시 기록된 인자가 1번 시나리오의 에러). 원인 구조: `clearAllMocks`는 구현을 안 지우는데 테스트마다 `mockImplementation`으로 통교체 + 테스트 본문 내 동적 `await import`가 경합 창 형성. 수정: 정적 import 이동 + `mockImplementationOnce`/`mockResolvedValueOnce`(assertion 불변). 전체 스위트+커버리지 2회 반복 재실행 클린 |
| **검증** | Doctor 오류 0건 / lint 0건 / tsc 프론트·Functions 통과 / sync --check·verify:gitignore·verify:fast 통과 / 프론트 652테스트+커버리지 게이트 통과(플레이키 수정 후 2회 반복 클린) / Functions 492테스트+신규 게이트 통과 / build 번들 예산 내 / 하네스 신규 테스트 48건 통과 / Rules 테스트 통과 / 비인증 E2E 69통과·인증 에뮬레이터 E2E 8통과 |
| **후속(CI 커버리지 게이트 분리)** | 배포 후 첫 CI에서 `functions-tests`가 커버리지 계측 때문에 20분 타임아웃 초과(취소). 원인 규명: GitHub 러너에서 커버리지가 실행 시간을 +15분(11분→26분) 늘리며 병목은 병렬성이 아닌 계측 자체(워커 3→4 튜닝을 PR에서 검증했으나 25.2→26.5분으로 무효). 결론: per-push `functions-tests`는 커버리지 없는 빠른 pass/fail 게이트(~11분)로 되돌리고, 커버리지 회귀 게이트는 신설 `functions-coverage.yml`이 주 1회 스케줄+수동으로 자동 검사(실패 시 관리자 메일). CI 성능 튜닝은 배포 미트리거 PR에서 검증해 프로덕션 무영향 |

---

### Phase 110: 누락 운행 소급 입력 경로 — 예약 없이 과거 운행 직접 기록 🚗📅 (CI 배포 완료)

> 2026-07-21, 프로덕션 실사용 기관 문의에서 출발. 직원이 누락된 과거 운행을 기록하려 "오늘 가짜 예약 → 주행하기 → 주행종료 → 내 기록에서 날짜 수정"이라는 편법을 쓰고 있었고, 그래도 예약은 오늘 날짜에 남는다는 질문. 원인 규명: **예약 없이 과거 날짜로 신규 운행일지를 쓰는 경로가 UI에 없음**(신규 폼은 날짜 필드 미노출·오늘 고정, 과거 날짜는 수정 모드에서만). 반면 km 계산(직전 endKm 자동채움·소급 플래그·연쇄 재정합 트리거)은 이미 구현돼 있어, 막힌 진입점만 열어주는 작업으로 확정. 요청받은 "예약 날짜 자동 동기화(A안)"는 소급 경로가 생기면 가짜 예약 자체가 불필요해져 후순위.

| 항목 | 내용 |
|------|------|
| **진입점** | `MyRecords`에 "누락 운행 입력" 버튼(점선, 검색 중 숨김) → `navigate('/employee/drive-log', { state: { retroactive: true } })`. react-router state로만 소급 모드 진입(직접 URL은 일반 신규) |
| **소급 모드 폼** | `useDriveLogForm`에 `retroEntry`(`state.retroactive && !editMode`) 파생. `DriveLogForm`이 수정 모드에서만 렌더하던 운행 일자 섹션을 소급 모드에도 노출 + "빈틈 메우기" 안내 배너·제목 분기. `isRetroactive`(=`driveDate !== today`)는 기존대로 자동 파생 → 저장 시 `isRetroactive:true` |
| **직전/직후 자동 조회** | `useDriveLogInitializer` Effect 3: 신규 모드에서 과거 날짜 선택 시 해당 일자 자정 기준 `getAdjacentDriveLogs`로 직전·직후 기록을 함께 조회(오늘 신규는 기존대로 최신 1건). → 출발km 자동채움(직전 endKm) + "직후 운전 정보" 배너·경고가 신규 모드에서도 활성화. 예약·빠른운행 흐름은 날짜가 항상 오늘이라 기존 분기 유지(회귀 없음) |
| **km 재정합** | 신규 로직 없이 기존 Cloud Function 트리거(`onDriveLogCreated`→`syncNextLogStartKm`) 재사용. 빈틈을 정확히 메우면(도착km=직후 출발km) 무변동, 아니면 뒤 기록을 diff만큼 이동(거리 보존). 소급은 `isRetroactive`로 currentKm 이중계산 방지 |
| **검증 공백 보강** | 무테스트였던 재정합 트리거에 단위 테스트 신설(`functions/src/__tests__/syncDriveLogKm.test.ts`, 6건) — `syncNextLogStartKm` export 후 인메모리 페이크 Firestore로 빈틈 무변동·이동 시 거리 보존·정렬 시 중단·**20건 상한**·소급 currentKm 미증분·최신 증분 검증 |
| **검증** | type-check·lint·프론트 빌드(번들 예산 내)·프론트 단위 38·Functions 빌드(tsc) 통과. 소급 UI 경로 에뮬레이터 E2E 신설(`authed-driveLogRetro`: 진입→날짜 노출→출발km 60123 자동채움→직후 배너→저장→소급 뱃지) 통과. 재정합 단위 6건 통과 |
| **커밋** | `b57435f`(feat) → CI·Deploy 배포 완료 |
| **후속(프로덕션 실사용 검증 중 발견·조치 — 2026-07-21 연속 배포)** | 사용자 실기기 테스트에서 나온 5건을 순차 배포. ① **의존성 DoS 권고**(brace-expansion·js-yaml·protobufjs·body-parser) `npm audit fix` non-breaking 패치(`64a9c26`, pre-push 보안감사 차단 해소). ② **FAQ 현행화**: 옛 편법(빠른출발→저장→수정) 안내 `delayed-log`·`retroactive-insertion`을 `missing-drive-log`(누락 운행 입력 버튼 + 빈틈 메우기)로 통합, `edit-log`는 편법 제거·수정/삭제 정리 (+대기 중이던 24시간 표시 항목 `time-format-24h` 동반, `72faefc`). ③ **입력 검증**: 도착km<출발km 인라인 경고 + 저장 버튼 비활성화, 차량 현재 누적 km 음수 방지(input min=0 + 저장 가드, `42c7907`). ④ **PWA 업데이트 미전파 근본 수정**: 커스텀 SW에 skipWaiting 부재로 새 배포가 waiting에 멈춰 하드 리프레시 없이는 반영 안 되던 문제 → `self.skipWaiting()` 추가(`f37d439`). clientsClaim은 첫 로드 리로드로 스모크 E2E "execution context destroyed" 하드 실패를 유발해 제외(=다음 내비게이션에서 반영하는 방식). ⑤ **E2E 하드닝**: 공개 페이지 클릭·입력의 하이드레이션 레이스를 toPass 재시도로 감싸 flaky 2→1 감소(`dc1c95e`) |
| **후속(미결)** | A안(내 기록 수정 시 연결 예약 날짜 자동 동기화 + 정합성 버그) 보류. 20건 초과 긴 체인 뒷부분 미보정은 테스트로 명시(현 규모 허용). SW 전환은 기기별 최초 1회 하드 리프레시/앱 재시작 필요(이후 자동). 스모크 E2E 잔여 기저 flaky(첫 로드 타이밍)는 retries:2로 흡수 |

### Phase 111: 캘린더 동기화 쿨다운·재시도 UI 차단 E2E 🗓️🧪 (커밋·PR)

> 2026-07-22, 외부 평가(Gemini 3.6 Flash)가 제시한 "캘린더 동기화 백오프 E2E 추가" 개선안을 실제 코드와 대조. 4대 개선안 중 3개(오프라인 큐·xlsx 동적 import·야간 통계 사전집계)는 이미 구현·배포된 상태였고, 남은 유의미 항목은 캘린더 동기화의 UI 차단 계약뿐이었다(핵심 백오프/쿨다운 로직 자체는 이미 구현·단위테스트 커버). 평가가 언급한 "2s→4s→8s + 30분 쿨다운"은 환각이 아니라 `useCalendarSync`의 실제 클라이언트 값이었음을 확인(서버는 별개로 `calendarFailTracking` failCount 기반 24h 쿨다운·10회 영구제외). 그 UI 반응만 E2E로 보강.

| 항목 | 내용 |
|------|------|
| **검증 대상** | Phase 96에서 도입한 '지금 동기화'/배경 동기화의 UI 계약. 서버 판정 로직(24h·failCount)은 functions 단위 테스트(`calendarReverseSync.test.ts`)가 이미 커버하므로 E2E는 그 응답에 UI가 올바르게 반응하는지(=차단·경고)만 본다(계층 분리) |
| **케이스 1** | 최근 동기화 이력(클라 30분 쿨다운, `last_calendar_sync_time_map`)이 있으면 예약 페이지 진입 시 배경 자동 동기화 콜러블을 호출하지 않는다(재시도 억제) → 호출 0회 |
| **케이스 2** | 수동 '지금 동기화'는 쿨다운을 우회해 1회만 호출하고, 서버가 `calendar-not-found`(=`shouldSkipVehicleCalendar` 쿨다운/영구제외가 반환하는 응답)를 알리면 지수 백오프(2s→4s→8s) 재시도 없이 경고 토스트를 노출 → 호출 1회 고정 |
| **모킹 전략** | `test:e2e:emulator`는 functions 에뮬레이터를 실행하지 않으므로(authed-driveLogCreate 참고) 콜러블 HTTP 엔드포인트를 `page.route`로 가로채 응답을 결정적으로 모킹. 크로스오리진(5174→5001) CORS 프리플라이트(OPTIONS)를 허용 헤더로 응답해야 POST가 일반 오류로 떨어져 3회 재시도되는 오탐을 막는다 |
| **시드 격리** | `TEST_CALENDAR_VEHICLE`(googleCalendarId 보유) + `seedCalendarLinkedVehicle`/`deleteCalendarLinkedVehicle` 신설. 기본 시드에 넣지 않고 해당 스펙 beforeAll/afterAll에서만 심어, 다른 인증 스펙이 불필요한 배경 캘린더 동기화(functions 부재로 실패)를 트리거하지 않도록 격리 |
| **검증** | type-check·ESLint(신규·수정 파일) 0, 신규 E2E 2케이스 통과(에뮬레이터, 총 18.3s). 첫 실행 vite 콜드 컴파일 타이밍은 로그인→리다이렉트를 `toPass` 재시도로 감싸 흡수(스펙 timeout 120s) |
| **커밋** | `9d8ee0d`(test) — 브랜치 `test/calendar-sync-cooldown-e2e` → PR |

### Phase 112: 예약 운행 10분 전 예약자 Slack DM 알림 🚗💬 (CI 배포 완료)

> 2026-07-23, "예약되면 Slack으로 알려주면 좋겠다"는 대화가 **"운행 시작 10분 전 예약자 본인에게 DM"**으로 구체화. 기존 Slack 연동은 inbound(직원이 봇에게 DM으로 예약·조회하는 대화형)뿐이라 앱→Slack outbound 알림은 없었다. 핵심 판단: "10분 전 감지"는 이미 예약 리마인더 스케줄러(`checkReservationReminders`, 15분 주기)가 하고 있고 그 블록이 FCM·인앱을 이미 발송 중 → **새 스케줄러/트리거 없이 같은 예약 집합·`reservedByUid`를 재사용해 Slack DM 한 줄만 추가**(재쿼리·중복 스케줄 회피 = 비용·정합성 유리). 별도 채널 브로드캐스트가 아니라 개인 DM 성격이라 예약자 본인 대상.

| 항목 | 내용 |
|------|------|
| **발송 지점** | `reservationReminder.ts`의 "예약 10분 전" 블록(운행일지 미작성·no-show 블록은 미변경). FCM·인앱 발송 직후 Slack DM 1건 추가 |
| **매핑** | 앱 계정 이메일 → Slack userId. `slackApi.lookupUserByEmail`(`users.lookupByEmail`) 신설 — 이미 보유한 `users:read.email` 스코프로 커버해 **새 스코프·기관 재연결 불필요**. `uid`→`users/{uid}.email`→lookup→`postMessage(botToken, slackUserId, text)` |
| **격리** | 신규 `notifySlackUser.ts`: `resolveOrgSlackBotToken(orgId)`가 예약의 `organizationId`로만 `findSlackIntegrationByOrg`→`getSlackIntegration`(복호화·enabled 검증)로 봇 토큰을 얻어 그 기관 토큰으로만 발송. 리마인더 루프에 org별 봇 토큰 캐시 Map(같은 run 중복 조회 1회로 상각) |
| **best-effort** | 미연동·이메일 불일치·Slack 미가입·API 오류는 모두 조용히 skip(내부 try/catch로 절대 throw 안 함). `reminderSent`는 기존대로 **FCM 기준** 유지 → Slack 실패가 재시도·중복·기존 알림 차단을 유발하지 않음 |
| **코드 리뷰(Gemini 대체)** | GitHub 무료 **Gemini Code Assist 서비스 종료**(2026-07-22, "code review activity has officially ceased") 확인 → 머지 전 diff를 독립 에이전트로 적대적 리뷰. 치명·중요 버그 없음(격리·예외 삼킴 견고). 실질 지적 1건 반영: `lookupByEmail`의 `users_not_found`/`missing_scope`(정상적 미매칭 skip)가 리마인더마다 WARNING 노이즈를 남기던 것을 `slackApiCallForm` `silentErrors` 옵션으로 억제. 봇 토큰 캐시 회귀 테스트 추가. 이중 read(users·integration)는 규모 대비 과잉 최적화라 의도적 제외 |
| **검증** | functions 단위 테스트 497→ 신규 `notifySlackUser.test.ts` 8건 + `reservationReminder.test.ts` Slack 케이스 3건 추가, 전체 통과. type-check(tsc)·ESLint 통과. CI·Deploy 배포 완료 |
| **커밋** | `96a87dc`(feat, squash) — 브랜치 `feat/slack-reservation-reminder` → PR #57 |
| **후속(미결)** | ⚠️ **스코프 실동작 확인**: 봇과 DM 이력 없는 사용자에게 userId를 channel로 직접 `chat.postMessage`하는 방식이라, Slack이 `cannot_dm_bot`/`channel_not_found`로 거부하면 `im:write` 스코프 추가 + 각 기관 재연결이 필요. 배포 후 실계정 1회 수신 확인 예정(실패 시 `conversations.open` 경로로 보강) |

### Phase 113: 어시스턴트 정비 거부 시 예약 컨텍스트 보존 + "변경해서 예약" 오분류 폴백 🤖🔧 (머지·CI 배포)

> 2026-07-24, 프로덕션 실사용(Socialprism)에서 발견: "모닝4578 14시~16시 익산역 예약해줘" → 정비 중 거부 → "스타렉스8888로 변경해서 예약해줘"에 봇이 날짜·시간을 처음부터 다시 되물음. 멀티턴 컨텍스트(Phase 106)는 있었으나 **정비 거부 경로에서만 `clearPending`으로 이미 받은 슬롯(날짜·시간·목적지)까지 폐기**한 게 근본 원인. 더해 "변경"이라는 단어가 LLM을 modify(기존 예약 수정)로 유도해 이어받기 자체가 불가했다. 프롬프트 유도만으로는 비결정적이라 **오케스트레이터 레벨에서 결정적으로** 해소.

| 항목 | 내용 |
|------|------|
| **컨텍스트 보존** | `handleAssistantMessage` 정비 거부 시 `clearPending`→**차량 슬롯만 비우고** 날짜·시간·목적지·용도는 `savePending` 유지. 응답도 "다른 차량 이름을 알려주시면 같은 조건(익산역 …)으로 예약해드릴게요"로 보존 사실을 명시 |
| **오분류 폴백** | create 완결 로직을 `completeCreate` 헬퍼로 추출(정상 경로·폴백 공유). modify 분기에서 후보 0건 + 진행 중 생성 슬롯 존재 시, 새 차량(`newVehicleId ?? vehicleId`)으로 **create 이어가기**로 폴백(LLM이 modify로 분류해도 무해). 상단 즉시 `clearPending`은 제거하고 실제 수정 대상 확정 시에만 폐기 |
| **크래시 가드** | 폴백에 미완결 슬롯(date·startTime null)이 넘어오면 `calcEndTimeFromDuration(null)`에서 죽던 것을 `completeCreate` 진입 가드로 방지(정상 경로는 `parseIntent` 재검증이 이미 보장해 무영향). 차량 미확정 시 범용 되묻기 대신 차량 전용 안내 |
| **프롬프트** | `parseIntent` pendingSection에 "진행 중 예약에서 `○○로 변경해서 예약`은 차량 슬롯을 채우는 create이며 기존 예약 modify가 아님"을 명시(오분류 1차 방어) |
| **코드 리뷰(Gemini 대체)** | 머지 전 diff를 독립 에이전트로 **2회 적대적 리뷰**. 1차: "변경" 단어의 modify 오분류로 헤드라인 시나리오가 조용히 실패할 위험(중간) 지적 → 오케스트레이터 폴백으로 반영. 2차: 폴백이 미완결 슬롯을 넘길 때 `calcEndTimeFromDuration(null)` 크래시(중간) 지적 → date·startTime 가드로 반영. 낮은 관찰 1건(진행 중 초안 있을 때 실제 modify 0건이 create 제안으로 전환) 확인 버튼 있어 수용 |
| **검증** | 회귀 테스트 3건 신설(정비 거부 슬롯 보존 / modify 오분류 이어받기 / 미완결 크래시 가드). functions 전체 50 suites/479 통과, `parseIntent` 23·`handleAssistantMessage` 41 포함. type-check(tsc)·ESLint(pre-commit) 통과, Node 22 |
| **커밋** | `3bd6395`(fix, squash) — 브랜치 `fix/assistant-blocked-vehicle-context` → PR #59. 플랫폼 독립 어시스턴트 코어(Slack·Google Chat 공용) 변경 |
| **후속(리뷰 관찰 해소)** | 리뷰가 남긴 낮은 관찰(진행 중 초안이 있을 때 **진짜** 예약 수정이 대상 0건이면 새 예약 제안으로 헷갈리게 전환)을 좁힘. 폴백 조건을 **새 스케줄 값(newDate·newStartTime·newEndTime) 없음**으로 한정 → 차량만 지목한 "○○로 변경해서 예약"만 create 이어가기, 시간 수정 시도는 "찾지 못했습니다"로 정확히 안내. 차량 교체 modify는 신호가 동일해 구분 불가하므로 의도적으로 create 이어가기 유지(초안 존재가 강한 신호). 회귀 1건 추가(42건 통과), 적대적 리뷰 실질 결함 없음. **CI 첫 실행에서 `theme-toggle` E2E 플레이키 실패 → 코드 변경 없이 재실행 그린**(functions 전용 변경과 무관 확인). 커밋 `2c3b464`, PR #63 |

### Phase 114: 신규 의존성 권고 대응 + 보안 감사 게이트 하드닝(레지스트리 장애 fail-open 차단) 🔒🚨 (CI 배포 완료)

> 2026-07-24~25, Phase 113 문서를 푸시하려는데 **pre-push 보안 게이트가 신규 High 권고로 차단**된 데서 시작. 권고를 하나씩 판정해 (1) 해당하는 건 패치, (2) 해당하지 않는 건 근거·재검토 조건과 함께 수용 등록으로 처리했다. 그 과정에서 등록부를 실제 차감에 연결하며 적대적 리뷰를 2회 받았고, **리뷰가 기존 게이트의 fail-open을 실증**해 그것까지 닫았다. "게이트가 막으면 우회(`--no-verify`)"가 아니라 "게이트를 신뢰할 수 있게 만든다"로 처리한 작업.

| 항목 | 내용 |
|------|------|
| **패치한 권고** | react-router/react-router-dom 7.17.0 → **7.18.1**(GHSA-wrjc-x8rr-h8h6 open redirect 등 4건, PR #60) / postcss 8.5.13 → **8.5.23**(GHSA-r28c-9q8g-f849 경로 순회, nanoid 3.3.16 전이 상향 동반) / brace-expansion → **5.0.8**(GHSA-mh99-v99m-4gvg DoS, 프론트·functions 양쪽). 전부 package.json 범위 내 비파괴(lock만 변경) |
| **수용 등록(1건)** | react-router **RSC Mode CSRF**(GHSA-qwww-vcr4-c8h2). 취약 범위 7.12.0~8.2.0에 패치 버전이 없고 `audit fix --force`는 7.11.0 **breaking 다운그레이드**를 요구. 이 앱은 순수 클라이언트 SPA(`appEntry.tsx`·`lightEntry.tsx`의 `BrowserRouter` + Vite 정적 빌드)로 RSC·SSR·서버 액션 미사용 → **취약 코드 경로 부재**를 코드로 확인(리뷰어 재검증: `react-router/rsc`·`createStaticHandler`·`matchRSCServerRequest`·`react-dom/server`·`entry.server` 전부 0 hit). 재검토 조건 명시(7.12+ 패치 출시 시 즉시 상향·항목 제거 / RSC·SSR 도입 시 수용 철회). 사용자 결정 |
| **게이트 fail-open 차단(핵심)** | `KNOWN_ACCEPTED`를 실제 차감에 연결하다 리뷰가 **기존 결함을 실증**: npm은 레지스트리 접속 실패 시 **종료 코드 0**으로 `{message, error}`만 내보내는데 기존 코드가 이를 "취약점 0건"으로 읽어 **네트워크 장애 한 번이 게이트를 통째로 통과**시켰다(2026-07-18 검증 보고서 #5의 P1 미조치분). `summarizeAudit()`이 리포트 형태(`auditReportVersion` + `metadata.vulnerabilities`)를 검증해 아니면 `null` → exit 1. 실측: `npm_config_registry=http://127.0.0.1:9` → 이전 exit 0 → **현재 exit 1** |
| **등록부 하드닝** | 등록부가 "문서"에서 "실행되는 게이트 설정"이 됐으므로 입력을 강제. ① advisory **GHSA 형식 검증** + URL 매칭을 `includes` → 마지막 경로 세그먼트 **정확 일치**(기존 설계면 `advisory: ''`·`'GHSA'` 오기입 하나로 **무관한 Critical까지 전부 차감**되어 audit이 exit 0이 되는 부비트랩) ② `pkg: 'a / b'` 문자열 split → `pkgs: string[]`(스코프 패키지 `@babel/traverse`가 `{'@babel','traverse'}`로 쪼개져 동명 unscoped 패키지의 미등록 전이분까지 차감되던 문제 제거) + npm 패키지명 형식 검증 ③ `validateRegistry()` 위반 시 fail-closed 중단 ④ **심각도 상승 시 수용 무효화**(객체 via·문자열 via 양쪽), 알 수 없는 심각도는 critical로 취급 ⑤ 항목별 매칭 건수 추적 → 0건이면 "이미 해소됨, 정리 필요" 경고(`revisitWhen` 방치 방지) ⑥ entrypoint 가드 realpath 비교 + 파일명 일치·경로 불일치 시 명시적 실패 |
| **코드 리뷰(Gemini 대체)** | 머지 전 **2회 적대적 리뷰**. 1차: 오기입 부비트랩·스코프 split 오작동(Medium 2건) → 형식 검증·배열 필드로 반영. 2차: 하드닝 계약이 테스트로 고정되지 않음/테스트가 살아있는 등록부에 결합되어 **항목 제거 시 테스트가 깨져 정리를 막음**/stale 경고가 네트워크 fail-open과 겹쳐 "살아있는 면제를 지우라"고 오지시(M1~M3) → 주입 가능 시그니처·픽스처 등록부·리포트 형태 검증으로 반영. 문자열 via 심각도 구멍(L3)·심각도 폴백 fail-open(L4)도 함께 수정 |
| **검증** | `scripts/__tests__/security-audit.test.ts` **37건 신설**(등록부 부정 케이스 10·리포트 형태 6·부분일치·심각도 상승·혼합 via·via 없음/빈 배열/null 원소·카운터). 픽스처 주입으로 실제 등록 내용과 결합 제거 → 향후 항목 제거가 테스트를 깨지 않음. 프론트 type-check·빌드(번들·CSS 예산 이내, 산출물 크기 불변)·단위 652 통과, functions 빌드·518 통과, 감사 게이트 통과(수용 2건 제외·잔여 0), ESLint 0 |
| **커밋** | `9e30b50`(react-router, PR #60) / `0df01ad`(postcss·brace-expansion + 수용 등록 + 게이트 하드닝, PR #64 squash) |
| **참고** | `scripts/`는 `tsconfig.json` include(`src`·`shared`) 밖이라 `tsc`가 커버하지 않는다 → 런타임 검증(`validateRegistry`)과 단위 테스트가 유일한 방어선. `--no-verify` 우회는 사용하지 않았다 |

### Phase 115: 거짓 녹색 E2E 제거 — theme-toggle을 useThemeSync 단위 테스트로 대체 🧪🌙 (CI 배포 완료)

> 2026-07-25, `theme-toggle` E2E가 이 세션에서 두 번 PR을 막았다(각각 retry 3회 실패 후 재실행으로 통과). "플레이키니 재실행"으로 넘기지 않고 조사한 결과 **인프라 문제가 아니라 테스트가 잘못 작성된 것**이었고, 통과할 때조차 아무것도 검증하지 않는 **거짓 녹색**이었다. Phase 114에서 "가드가 막으면 우회 대신 신뢰할 수 있게 만든다"와 같은 판단을 테스트에 적용한 회차.

| 항목 | 내용 |
|------|------|
| **근본 원인** | 스펙이 `page.goto('/')`로 진입하는데 비인증 `/`는 `lightEntry.tsx`가 렌더하고 **lightEntry는 `App`을 마운트하지 않아** 검증 대상 effect가 애초에 실행되지 않았다. 게다가 `LandingPage`는 `useForceLightMode()`로 dark를 의도적으로 제거하는데, 스펙은 그 위에서 dark를 수동으로 붙이고 "있어야 한다"고 단언 → 앱 설계와 충돌하는 레이스(통과·실패가 effect 타이밍에 좌우) |
| **거짓 녹색 3종** | ① 토글 버튼 셀렉터가 실제 구현과 불일치해 항상 `else` 폴백(클래스를 직접 붙이고 붙었는지 확인 = 자기충족) ② 두 번째 테스트 `expect(getComputedStyle(...).backgroundColor).not.toBeNull()` — 문자열은 null이 될 수 없어 **다크모드가 깨져도 항상 통과** ③ `localStorage` 키를 `'theme'`로 썼는데 스토어가 읽는 키는 `'theme-preference'`. 진짜 토글 버튼은 로그인 후 `MorePage`에 있어 비인증 E2E로는 도달 불가 |
| **조치** | `App.tsx` 인라인 `useEffect`(html `dark` 클래스 + `theme-color` 메타 동기화)를 **`useThemeSync` 훅으로 추출**(기존 `useForceLightMode`와 같은 패턴이자 짝) → 단위 테스트 가능하게. `e2e/theme-toggle.spec.ts` 삭제 |
| **신규 테스트** | `useThemeSync.test.ts` **7건**: dark 추가/제거, 스토어 변경 추종 토글, `theme-color` 메타 동기화(양방향·변경 추종), 메타 부재 시 무예외. 초안이 프로젝트의 **'거짓 녹색' 가드**(`src/__tests__/setup.ts`가 React act 경고를 테스트 실패로 승격)에 걸려 `act()`로 수정 — 가드가 실제로 작동함을 확인 |
| **판단(범위 제외)** | 버튼 클릭까지 검증하려면 인증 E2E(`test:e2e:emulator`)가 필요하나 순수 DOM 동기화 로직이라 단위로 완전히·결정적으로 커버되어 규모 대비 이득이 작아 제외 |
| **코드 리뷰(Gemini 대체)** | 머지 전 독립 에이전트 적대적 리뷰 — 차단 결함 없음. effect 등록 순서·구독 방식·색상 상수(`index.html` FOUC 스크립트와도 일치) 동일성 확인, 뮤테이션 관점으로 7건이 각각 무엇을 죽이는지 검증(조건 반전·색상 스왑·`dep []` 비반응형화). 리뷰어가 삭제 근거를 더 강화(lightEntry 미마운트). 낮은 관찰 2건은 스코프 밖으로 기록(아래) |
| **검증** | 프론트 단위 **83 파일/696건 통과**(신규 7), type-check·ESLint 0, 빌드·번들 예산 이내. **CI 재실행 없이 1회 통과** |
| **커밋** | `14112aa`(test, squash) — 브랜치 `fix/theme-toggle-flaky-e2e-to-unit` → PR #68 |
| **남은 관찰(미조치)** | ① **호출부 무검증**: `App.tsx`의 `useThemeSync()` 한 줄을 지워도 잡는 테스트가 없다(원본 인라인 effect도 동일해 회귀는 아님). 보강하려면 authed 에뮬레이터 스펙에서 로그인 후 `html.dark` 1건 확인 ② **`useForceLightMode` 스냅샷 결함(기존)**: 공개 페이지 체류 중 스토어 theme이 dark→light로 바뀌면 이탈 시 마운트 시점 스냅샷(`wasDark`)으로 dark가 되살아나고, `useThemeSync`는 `theme`이 이미 light라 재실행되지 않아 어긋난 상태가 유지된다 |

### Phase 116: 공개 페이지 테마 desync 제거 — 스냅샷 복원 폐기 + lightEntry 불변식 정적 강제 🌙🔒 (CI 배포 완료)

> 2026-07-25, Phase 115가 남긴 관찰 ②를 해소. `useForceLightMode`가 마운트 시점 DOM 상태를 스냅샷(`wasDark`)으로 떠서 언마운트 시 복원하던 탓에, 공개 페이지 체류 중 테마가 바뀌면 낡은 값이 되살아나 DOM↔스토어가 어긋난 채 유지됐다. 수정 자체는 2줄이지만, **적대적 리뷰가 그 2줄이 만든 새 구조적 위험을 찾아** 함께 닫은 것이 이 회차의 핵심이다(렌더 경로 이중화 교훈의 재확인).

| 항목 | 내용 |
|------|------|
| **원 결함** | 스냅샷 복원 → 체류 중 테마 변경 시 desync. 재현: 로그인 상태로 `/faq` 딥링크 → `App.tsx`의 Firestore 테마 동기화가 늦게 도착해 체류 중 `setTheme` → 이탈 시 낡은 스냅샷이 dark를 되살림 → `useThemeSync`는 `theme` 값이 그대로라 재실행되지 않아 **DOM은 다크, 스토어는 라이트로 어긋난 채 유지**. (`matchMedia` 경로도 같은 결과지만 `theme-preference` 미저장일 때만 발화) |
| **조치 1** | 스냅샷 폐기 → 언마운트 시 **스토어 현재값으로 재적용**(`classList.toggle('dark', theme === 'dark')`). 스토어를 단일 진실로 삼아 체류 중 어떤 경로로 바뀌어도 어긋나지 않음 |
| **리뷰가 찾은 새 위험(Medium)** | 위 변경으로 이 훅의 cleanup이 **lightEntry(비로그인)에서 dark를 켤 수 있는 유일한 경로**가 됐다. 그 경로엔 `useThemeSync`가 없고 `index.html` 부트 스크립트도 `theme-color`만 설정하므로 **되돌릴 주체가 없다**. 당시엔 도달 불가(훅 없는 라우트는 `/terms`·`/privacy` 둘뿐이고 `<a href>` 전체 이동으로만 진입해 cleanup 미실행)였으나, `<Link>` 전환이나 공개 라우트 추가 순간 dark가 **영구 잔류** → 공개 페이지 배경엔 dark 변형이 없어 밝은 배경 + 다크용 흐린 텍스트로 대비 파손 |
| **조치 2** | `TermsPage`·`PrivacyPage`에 훅 추가 → lightEntry **모든 라우트가 훅 호출** 상태로 복원(cleanup이 켠 dark는 다음 페이지 마운트가 같은 flush에서 제거 → 깜빡임 없음). 루트에 `useThemeSync`를 넣는 대안은 lightEntry가 lazy가 아니어서 자식 effect 우선 순서로 강제 라이트가 깨지므로 기각 |
| **불변식 정적 강제** | `scripts/__tests__/lightEntryForceLightMode.test.ts` 4건 — `lightEntry.tsx`의 `Route element`를 파싱해 각 컴포넌트가 훅을 호출하는지 검사. 훅 없는 공개 라우트를 추가하면 실패한다. `InAppBrowserGuard`는 순수 위임 래퍼라 예외로 두되 **대체 분기(`InAppBrowserWarning`)도 훅을 쓰는지 별도 검증**, "lightEntry에 `useThemeSync`가 없다"는 전제 자체도 테스트로 고정. 렌더링 대신 정적 검사를 쓴 이유: 라우트 추가는 소스 편집이라 정적으로 충분하고 공개 페이지 전체 렌더 비용(라우터·SEOHead·Firebase)을 피함. `src/` tsconfig에 Node 타입이 없어 `scripts/__tests__/`에 배치(`check-harness.test.ts`와 같은 성격) |
| **뮤테이션 검증** | `TermsPage`의 훅 호출을 지우니 신규 테스트가 `TermsPage`를 지목해 실패함을 실측 확인 후 되돌림 — 가드가 실제로 회귀를 잡는다 |
| **코드 리뷰(Gemini 대체)** | 적대적 리뷰 1회. Medium 1건(위 lightEntry 소유자 부재) + Low 3건 지적 → 전부 반영: desync 트리거 설명을 더 도달 쉬운 경로(Firestore 동기화)로 정정, 테스트 `afterEach` 스토어 복원 추가, `act()` 불필요 근거 주석. 리뷰는 사용처 6곳 전수·마운트 순서(자식→부모)·순환 import·StrictMode 이중 마운트도 함께 검증 |
| **검증** | 프론트 단위 **84 파일/702건 통과**(신규 6 = 훅 회귀 2 + 불변식 4), type-check·ESLint 0. **CI 재실행 없이 1회 통과** |
| **커밋** | `8fed4c9`(fix, squash) — 브랜치 `fix/force-light-mode-stale-snapshot` → PR #70 |
| **미조치(의도)** | ① **체류 중 강제 라이트 미보장**: 훅의 effect가 `deps []`라 체류 중 스토어가 light→dark로 바뀌면 `useThemeSync`가 붙인 dark를 재차단하지 않는다(기존 동작·회귀 아님). "공개 페이지는 항상 라이트"를 보장하려면 훅이 스토어를 구독해야 함 ② **Phase 115 관찰 ①(호출부 무검증)**: 인증 E2E 비용 대비 이득이 작아 제외 유지 |

### Phase 117: 공개 페이지 강제 라이트 — 단일 writer 구조로 재설계 🌙🏗️ (CI 배포 완료)

> 2026-07-25, Phase 116이 남긴 미조치 ①(체류 중 강제 라이트 미보장)을 해소. **단순 수정이 통하지 않는 문제**였다 — 훅에 `deps: [theme]`을 추가하면 될 것 같지만, React effect가 자식→부모 순으로 실행되므로 부모인 `useThemeSync`가 항상 나중에 실행되어 dark를 다시 붙인다. 소유권을 재설계해야 풀리는 구조적 문제였고, 그 과정에서 테스트가 "정작 바꾼 메커니즘을 지나지 않는" 공백도 리뷰가 잡아냈다.

| 항목 | 내용 |
|------|------|
| **결함** | 공개 페이지 **체류 중** 스토어 테마가 light→dark로 바뀌면 페이지가 다크로 뒤집힘. 도달 경로가 좁지 않다 — `App.tsx`에도 `/faq`·`/terms`·`/privacy`·`/release-notes`·`/apply`가 있어 **로그인한 다크 사용자가 그 링크를 열면** Firestore 테마 동기화가 도착하며 보고 있는 중에 전환됐다 |
| **왜 단순 수정이 안 되나** | effect 실행 순서가 자식→부모. 테마 변경 시 같은 커밋에서 `useForceLightMode`(자식)가 dark를 제거해도 `useThemeSync`(부모)가 나중에 실행되며 다시 붙인다 → 부모가 항상 이김 |
| **조치(단일 writer)** | dark 클래스를 쓰는 주체를 `useThemeSync` 하나로 모았다. `useThemeStore`에 `forceLightCount` + `push/popForceLight` 추가(공개 화면이 동시에 여러 개일 수 있어 불리언이 아닌 **카운터**, `pop`은 `Math.max(0, …)`로 음수 방지 — 중복 해제가 강제 라이트를 영구히 꺼버리지 않도록). `useForceLightMode`는 DOM을 만지지 않고 카운터만 조작. `useThemeSync`가 `isDark = theme === 'dark' && !forceLight`로 단독 결정하고 `theme-color` 메타도 실제 적용값과 통일 |
| **부수 효과** | Phase 116이 막았던 "lightEntry에 dark 영구 잔류" 위험이 **구조적으로 소멸**(이 훅이 더는 DOM에 쓰지 않으므로 lightEntry에는 dark writer가 아예 없다). 리포 전체에서 `<html>`의 dark를 쓰는 코드는 `useThemeSync` 한 곳뿐 |
| **리뷰 지적 [중] — 커버리지 공백** | 기존 테스트가 `forceLightCount`를 **직접 주입**해 이 변경의 핵심(push/pop + 부모·자식 순서)을 지나지 않았다. `useThemeSync`가 카운터 구독을 잃어도 전부 녹색. → `themeForceLightIntegration.test.tsx` 6건 신설(실제 부모/자식 트리 렌더): 진입 시 라이트·이탈 시 선호 복귀·**체류 중 dark 전환에도 뒤집히지 않음**·앱 화면은 선호 적용·**StrictMode 이중 마운트 누수 없음**·동시 2개 중 하나 빠져도 요구 유지. **뮤테이션 검증**: 구독을 제거하니 9건 실패(이전엔 통과) |
| **리뷰 지적 [하]** | ① "순서 경쟁 자체가 사라진다" → **"최종 적용값의 경쟁이 사라진다"**로 교정. 두 훅 모두 passive `useEffect`라 라우트 전환 시 직전 클래스가 1프레임 살아남을 수 있음을 명시(master도 동일·회귀 아님). `useLayoutEffect`면 없어지지만 동기 레이아웃 비용 대비 이득이 작아 미채택 ② 낡은 주석 정정(테스트 헤더가 "dark를 제거하는데"라고 서술) + "새 공개 라우트 추가 시 훅 호출" 불변식 포인터 복원 + 불변식 테스트의 appEntry 재사용 목록에 `/`·`/login` 추가 ③ 불변식 테스트가 공개 페이지를 **lightEntry에서만 열거**하므로 App.tsx에만 라우트를 추가하면 통과하는 한계를 파일에 기록 ④ 근-무의미 단언 교체(`forceLightCount` 2→1은 파생 셀렉터 `>0`이 동일해 effect 재실행이 없어 훅 본문을 지워도 통과) |
| **리뷰 확인(결함 없음)** | 카운터 누수 없음을 실측 — StrictMode 이중 마운트 최종 1·언마운트 0, push 플러시 전 root 언마운트 시 push·pop 동반 폐기로 순증 0, `lightRoot.unmount()`가 pop을 동기 실행해 appEntry는 항상 0에서 시작. 스토어에 `persist`가 없어 어떤 누수도 리로드로 자연 치유. 두 root가 모듈 싱글턴 스토어를 공유(manualChunks에 별도 항목 없어 dedupe) |
| **검증** | 단위 **85 파일/712건 통과**(신규 6), type-check·ESLint 0, 빌드·번들 예산 이내. **CI 재실행 없이 1회 통과** |
| **커밋** | `75ea639`(fix, squash) — 브랜치 `fix/force-light-single-writer` → PR #72 |
| **후속(별건·미조치)** | ① **lightEntry의 theme-color 불일치**: 그 경로엔 `useThemeSync`가 없어 `index.html` 인라인 스크립트가 박은 다크 색상이 남는다 → 비로그인 공개 페이지는 라이트 화면 + 다크 상태바(안드로이드) ② **`/apply` 다크 변형이 죽은 코드**: `OrgApplicationPage`는 `dark:from-surface-950` 등을 온전히 갖췄는데 강제 라이트라 쓰이지 않는다 — 강제 라이트가 의도인지 다크 지원이 의도인지 결정 필요 |

### Phase 118: lightEntry 테마 소유자 + 기관신청 다크 지원 활성화 🌙🧩 (CI 배포 완료)

> 2026-07-25, Phase 117이 남긴 후속 별건 2건을 함께 해소. **둘 다 Phase 117의 단일 writer 구조가 전제 조건**이었다 — 그 구조가 없었으면 ①은 강제 라이트를 깨뜨렸고 ②는 판단 근거가 없었다.

| 항목 | 내용 |
|------|------|
| **① lightEntry theme-color 불일치** | 비로그인 경로에 테마 소유자가 없어 `index.html` 인라인 스크립트가 박은 **다크 `theme-color`가 라이트 화면에 그대로 남았다**(안드로이드에서 상태바만 어두움). 신규 `ThemeRoot`로 감싸 `useThemeSync`를 마운트해 해소 |
| **왜 이제야 가능한가** | 예전에는 둘 수 없었다 — `useForceLightMode`가 DOM을 직접 만지던 시절엔 부모로 두면 effect 순서(자식→부모)로 강제 라이트가 덮여 깨졌다. Phase 117로 dark writer가 하나뿐이고 강제 라이트는 카운터로 전달되므로 순서와 무관하게 안전해졌다 |
| **② 기관신청 다크 활성화** | `/apply`가 `dark:` 40곳을 갖췄는데 강제 라이트로 전부 사장돼 있었다. 정적 감사에서 **색상 클래스 누락 0**(dark: 없는 className 3개는 `text-center`·`text-xs` 등 색 무관)으로 확인 → 다크 지원이 원래 의도로 판단하고 `useForceLightMode` 제거, 사용자 테마를 따르게 했다. 나머지 공개 페이지 4곳(FAQ·약관·개인정보·릴리즈노트)은 최상위 배경에 dark 변형이 없어 **강제 라이트 유지** |
| **구조** | `react-refresh` 규칙상 `lightEntry.tsx`는 비컴포넌트(`renderLightApp`)를 export하므로 컴포넌트를 같은 파일에 둘 수 없어 `components/common/ThemeRoot.tsx`로 분리. appEntry는 `App` 본문에서 `useThemeSync`를 직접 호출하므로 이 래퍼가 불필요 |
| **불변식 테스트 갱신** | 전제를 "lightEntry에 소유자 없음" → **"`ThemeRoot`를 마운트함"** 으로 교정(①의 결과로 이제 두 경로 모두 소유자를 가짐). `OrgApplicationPage`를 EXEMPT에 추가하되 **예외 근거가 사실인지 검증하는 테스트를 함께 넣었다**(최상위 dark 배경 존재 + 훅 미호출) — 예외를 근거 없이 늘리지 못하게. 훅 이름이 주석에 언급될 수 있어 포함 검사 대신 `useForceLightMode(` 호출 여부로 판정 |
| **검증** | 단위 **85 파일/713건 통과**, type-check·ESLint 0, 빌드·번들 예산 이내, **비인증 E2E 67건 통과**(lightEntry 렌더 경로 변경이라 회귀 확인). CI 재실행 없이 1회 통과 |
| **커밋** | `3f743f7`(fix, squash) — 브랜치 `fix/light-entry-theme-owner` → PR #74 |

### Phase 119: App Check 3차 강제 — 비용 유발 callable 7종 🔒💰 (CI 배포 완료)

> 2026-07-25, 개선계획서 1~3주차 §3의 3차 배치. `06e155f`(2026-07-19, OCR·askAI 3종)가 **"2차 강제의 2영업일 무이상 관찰 게이트 통과 후 병합, 게이트 이전 배포 금지"** 로 보류해둔 작업을 잇는다. 이 회차의 핵심은 플래그 7개를 켠 것이 아니라, **적대적 리뷰가 "강제하면 실패가 보이지 않는다"는 관찰 불가 문제를 찾아낸 것**이다 — 그 수정 없이 배포하면 계획서가 요구한 관찰 게이트 자체가 무의미했다.

| 항목 | 내용 |
|------|------|
| **대상 선정** | 미강제 15종을 분류해 **남용이 곧 과금**인 7종만 먼저: `askAI`·`ocrDashboard`·`ocrDocument`(Gemini), `sendManualApprovalAlimtalk`·`sendManualRejectionAlimtalk`(알림톡), `sendApprovalEmail`·`sendRejectionEmail`(Gmail). 피해 반경이 좁고 되돌릴 함수가 적은 순서 |
| **게이트 충족 실측** | Firestore가 **이미 강제 상태**에서 지난 7일 33만 건 중 확인 100%·**알 수 없는 출처 0건**(꼬리 122건 = 0.037%, 계획서 <1% 기준 충족). Firestore 직접 write는 이 7종과 **같은 로그인 세션·같은 기본 앱·같은 App Check 토큰 경로**라, 강제 하에서 측정된 이 값이 곧 실제 차단 반경 → 신규 차단 사실상 없음. Functions는 콘솔 강제 토글이 없어(코드 플래그) 함수별 행 대신 이 지표를 근거로 삼았다 |
| **호출 경로 전수 확인** | 7종 모두 인증 화면에서만 호출되고 그 번들은 `lib/firebase.ts`가 App Check를 초기화한다. 호출부가 `getFunctions(undefined, …)`로 **기본 앱**을 쓰는데 `firebaseAuth.ts`가 `getApps().length > 0 ? getApp() : …`로 같은 앱을 재사용하므로 인스턴스 불일치가 없다. 인앱 브라우저는 `firebase.ts`의 `!isInAppBrowser()` 조건으로 App Check가 **미초기화**지만, `App.tsx`의 `InAppBrowserGuard`가 인증 화면 전체를 `InAppBrowserWarning`으로 대체해 도달 불가 — 두 판정이 **동일 술어**라 "미초기화 + 가드 통과" 조합이 원리적으로 불가능 |
| **리뷰 지적 [중] — 실패가 블라인드** | 3층을 SDK 소스로 확인: ① `@firebase/functions`의 `getAppCheckToken`이 토큰 교환 에러를 **reject하지 않고 헤더만 생략**한 채 호출(`if (result.error) return null`) ② 서버는 `app === "MISSING" && enforceAppCheck`에서 **핸들러 진입 전** 거절 → `wrapCallableHandler`의 `log("ERROR")`·`flushSentry()`를 타지 않아 Sentry·Discord 무신호 ③ `App.tsx`의 Phase 90 안내 토스트는 `unhandledrejection` 리스너라 ①때문에 발화하지 않고, `sentry.ts`의 `ignoreErrors`가 원인 에러도 제거. 결과: reCAPTCHA가 차단·throttle된 직원이 계기판을 촬영하면 **"사진이 흐릿하지 않은지 확인"** 이 떠서 재촬영만 반복하고 운영자는 아무것도 못 본다 |
| **조치** | 직원이 쓰는 3곳(`useDriveLogOcr`·`useFuelLog`·`AskAIModal`)에 `functions/unauthenticated` 분기 추가 → "보안 인증에 실패했습니다. 잠시 후 다시 시도…". 로그인 상태에서 이 코드는 App Check 미첨부가 사실상 유일한 원인이다. 빈도는 낮다는 실측(위 0건)이 있지만, **발생 시 오안내 + 무신호**는 별개 문제라 함께 닫았다 |
| **리뷰 지적 [중] — 되돌려도 CI 그린** | `onCall` 옵션은 export되지 않아 런타임 검증이 불가하고 기존 테스트는 rate-limit 키만 참조 → **커밋을 revert해도 전 테스트 통과**. `scripts/__tests__/enforceAppCheckInvariant.test.ts` **7건** 신설: 미강제/미선언 목록과의 **정확 일치**(어느 방향 변화든 목록 갱신을 요구), 3차 7종 강제 유지, 각 항목의 **근거가 사실인지**(공개 폼은 인증 미요구 / 대기 항목은 인증 요구)까지 검증. 수집 0건이면 무의미 통과라 파일 수 전제도 고정. **뮤테이션 검증**: `ocrDashboard`를 `false`로 되돌리니 2건이 파일명을 지목해 실패 |
| **가드가 찾은 공백** | Slack 콜러블 4종(`diagnoseSlackConnection`·`disconnectSlack`·`getSlackConnectionStatus`·`getSlackInstallUrl`)이 `enforceAppCheck`를 **아예 선언하지 않아** 기본값(미강제)에 기대고 있었다 — Slack 멀티테넌트 배치에서 판단 누락. 넷 다 `!request.auth` 검사가 있고 관리자 화면(`useSlackIntegration`) 전용이라 강제가 **가능**하나, 스코프를 임의로 늘리지 않고 `MISSING_DECLARATION`으로 명시해 4차 대상으로 남겼다 |
| **리뷰 지적 [중] — 롤백 경로 부재** | `enforceAppCheck`는 Firestore 강제와 달리 **콘솔 킬스위치가 없어** 재배포가 유일한 복구 경로인데, CI(`deploy.yml`)·긴급 워크플로 모두 `--only functions` 전량 배포뿐이었다. `.agent/workflows/rollback.md`에 `--only functions:<name>` 단독 배포 절차 추가(`index.ts`가 개별 export하므로 가능) |
| **판단(범위 제외)** | 공개 폼 2종(`submitOrgApplication`·`submitPublicFeedback`)은 토큰이 있어도 실패 시 **기관신청 유입이 막히는 획득 경로**라 제외. 인증 전용 미강제 9종(방침 대기 5 + 미선언 4)은 4차에서 결정 — 특히 같은 훅에서 `regenerateFeedbackDraft`는 강제, `sendFeedbackReply`는 미강제인 **정책 모순**이 정리 대상 |
| **검증** | 프론트 단위 **86 파일/720건 통과**(신규 7), Functions **51 suites/518건**, type-check·ESLint 0, 빌드·번들 예산 이내. CI 재실행 없이 1회 통과 |
| **커밋** | `07ef77f`(feat, squash) — 브랜치 `feat/appcheck-batch3-cost-callables` → PR #76 |
| **관찰(진행 중)** | 배포 후 **2영업일**: App Check invalid/expired <1%, callable `unauthenticated`/`permission-denied` 오류율 7일 평균 대비 +20% 미만. 이상 시 해당 함수만 `false` 복원 **단독** 재배포(위 3-1 절차) |

---

### Phase 120: 품질 평가 후속 — 출력물·경로 테스트 보강(+PDF 표기 버그) · 앱 체크 4차 · 이력 분할 🧪🔒📚 (CI 배포 완료)

> 2026-07-25, 프로그램 전반 품질 평가(항목별 채점)에서 도출된 개선 3건을 우선순위 순으로 처리. 평가의 결론은 "보안·문서·CI는 상용 수준인데 **프론트 테스트만 균형이 깨져 있고, 그중에서도 조용히 틀릴 수 있는 출력물·계산 로직이 비어 있다**"였다. 이 회차의 핵심은 커버리지 숫자가 아니라, **그 빈 자리에서 실제로 인쇄물이 틀리고 있었다는 것을 테스트가 즉시 찾아냈다**는 점이다.

| 항목 | 내용 |
|------|------|
| **P1 대상 선정 근거** | 전체 커버리지를 올리는 대신 **틀려도 안 보이는 곳**만 골랐다. `lib/pdf`(5.4%)는 기관이 대외 제출하는 최종 산출물이고, `lib/tmap`(15.9%)은 거리·시간·통행료 숫자를 예약 화면에 그대로 노출한다. 둘 다 실패해도 예외가 안 나고 **값만 조용히 틀린다** |
| **발견한 버그 (fix)** | 운행일지 PDF '하이패스 포함' 출력에서 **사용액과 잔액이 뒤바뀌어 인쇄**되고 있었다. `hipassBalanceAfter`는 '사용 후 잔액'인데 이를 '사용액'으로, `before - after`(실제 사용액)를 '남음'으로 찍었다. 잔액 10,000 → 8,500이면 "8,500원 사용, 1,500원 남음". 저장부(`submitDriveLog`의 `usedAmount`)·화면(`VehicleStatusSection`)·Excel(`excelExport`)은 모두 올바른 규칙이라 **PDF만** 어긋난 상태 — 같은 값을 네 곳이 각자 해석하던 구조의 대가다. 사용액 하한 0도 함께 적용(충전 후 기록 등) |
| **테스트 접근** | `window.open` → `document.write` 경로를 하네스(`printWindowHarness`)로 가로채 **쓰인 HTML을 DOM으로 파싱하고 표 구조를 단언**한다. 문자열 부분일치가 아니라 실제 출력물을 보므로 레이아웃 회귀를 잡는다. 핵심은 **조건부 컬럼 정합성 불변식**: 주유·동행자 컬럼은 헤더/데이터행/빈행/소계행/합계행 다섯 곳에 흩어져 있어 한 곳만 빠뜨려도 타입 검사·린트는 통과하고 인쇄물의 표만 어긋난다 |
| **PDF 테스트 136건** | `pdfEngine`(3개 리포트 공용 엔진) 34 · `pdfExport`(운행일지 양식) 36 · `dailyLogPdfExport`(일별 양식) 26 · 주유/하이패스/정비 3종 40. 페이지 분할·정렬·소계/합계·결재란·팝업 차단·XSS 이스케이프를 고정. **5.4% → 97%** |
| **tmap 테스트 108건** | `core` 33(쿨다운 누적 규칙 일반 3회/429 즉시, 요청 큐 1200ms 간격, localStorage 캐시 영속화, fetch 응답 분기) · `geocoding` 27(3단 폴백: 괄호 주소 → 장소명 → 지오코딩 API) · `routing` 30(m→km 내림·초→분 반올림, 좌표 5자리 캐시 키, **다중 목적지 편도 합산 = 복귀 구간 제외**) · `deeplink` 18(T-Map/네이버/카카오 스킴·경유지). **15.9% → 97%** |
| **테스트 하네스 설계** | tmap `core`는 쿨다운·큐·캐시를 모듈 전역 상태로 들고 있어 `vi.resetModules()`가 필수인데, 처음에 `vi.mock(core)` 부분 모킹으로 짜니 **팩토리 결과가 재사용되어 쿨다운이 다음 테스트로 샜다**(10건 실패). core는 모킹하지 않고 **global fetch만 대체**하는 방식으로 전환하고, 큐의 1200ms 간격은 가짜 타이머 헬퍼(`settle`)로 건너뛴다 |
| **커버리지 게이트** | 전체 lines 29.17 → **32.46**, branches 18.19 → **22.37**, statements 27.98 → 31.51, functions 22.31 → 25.27. 임계치를 실측 −1pp로 재상향(lines 28→31, stmts 27→30, funcs 21→24, branches 17→21) |
| **P2 앱 체크 4차** | Phase 119가 4차로 미뤄둔 인증 전용 미강제 5종 중 **비용·민감도 상위 2종**: `sendAdminNotice`(기관 전체 FCM 팬아웃 = 과금·스팸), `getOrgDocumentUrl`(사업자등록증·고유번호증 서명 URL. 같은 심사 화면의 `ocrDocument`는 이미 강제라 **정책이 갈려 있던** 119 리뷰 M2 항목) |
| **호출부 정리** | `AdminNotice.tsx`가 `getFunctions(undefined, …)`로 인스턴스를 따로 만들고 있었다. 기본 앱이라 App Check 토큰은 붙지만 `firebase.ts`의 공용 인스턴스(에뮬레이터 연결 포함)와 어긋날 수 있어 `firebaseFunctions`로 통일. `getOrgDocumentUrl` 호출부(`orgDocument.ts`)는 `getFunctions(firebaseApp, …)`로 앱을 명시 전달해 이미 안전 |
| **가드 갱신** | `enforceAppCheckInvariant`의 `PENDING_DECISION`에서 2종을 빼고 `BATCH4_ENFORCED`로 개별 고정(8건). 목록 **정확 일치** + 개별 `true` 확인 이중 가드라 되돌리면 두 군데서 실패한다 |
| **판단(범위 제외)** | 남은 3종(`sendFeedbackReply`·`testCalendarAccess`·`triggerOnDemandCalendarSync`)은 **진단·동기화 계열**이라 강제 실패가 곧 "관리자가 연결 문제 원인을 못 찾는" 상황이 된다 — 강제의 이득보다 부작용이 커서 다음 배치로 미뤘다. 미선언 Slack 4종도 유지 |
| **P3 이력 분할** | `구현이력.md`가 2,049줄/272KB까지 커져 검색은 되지만 열어서 훑는 게 불가능했다. **색인(15KB) + 구간 4파일**로 분할하고 원래 경로는 색인으로 유지(기존 문서·링크 보존). 본문은 라인 범위로만 잘라 옮기고 한 글자도 고치지 않았다 — Phase 헤딩 135개 완전 일치, 라인 수 차이는 색인으로 옮긴 머리말 7줄 + 각 파일 안내 4줄로 정확히 설명 |
| **분할 구성** | `트랙A_Phase1-58`(83KB) · `트랙B_Phase49-81`(70KB) · `트랙B_Phase82-102`(57KB) · `트랙B_Phase103부터`(열린 구간, 새 Phase는 여기에 append). 색인에 Phase 135개 전체 목록(접힘) + **두 트랙이 49~58에서 겹쳐 번호만으로는 파일이 특정되지 않는다**는 주의 명시 |
| **열린 구간 명명** | 처음엔 `트랙B_Phase103-119.md`로 두었으나 Phase 120을 append하는 순간 이름이 거짓이 된다. Phase마다 리네임하면 링크가 깨지므로 **열린 구간은 `…103부터`**, 구간이 닫힐 때 최종 범위명으로 한 번만 리네임하는 규칙으로 정리 |
| **검증** | 프론트 단위 **94 파일/965건**(신규 244), Functions **51 suites/518건**, `verify:harness` 12영역 0오류 0경고, ESLint·type-check(프론트+Functions) 0, 빌드 성공·번들 gzip 938.3KB/970KB(변동 없음). CI 6체크 1회 통과 |
| **커밋** | `ef88785`(squash) — 브랜치 `test/pdf-tmap-coverage-appcheck-2026-07-25` → PR #79. 내부 4커밋(`fix(pdf)` / `test` / `feat(security)` / `chore(docs)`)으로 성격 분리 |
| **관찰(진행 중)** | 배포 완료(Deploy `30150994028`, 두 함수 Successful update 확인). 배포 후 **2영업일**: App Check invalid/expired <1%, 두 함수의 `unauthenticated` 오류율 7일 평균 대비 +20% 미만. `npm run health` 직후 에러 0이나 **두 함수가 아직 호출되지 않았을 수 있어** 관리자 공지 발송 1건·증빙서류 열람 1건 수동 확인 필요. 이상 시 해당 함수만 `false` 복원 단독 재배포 |
| **남은 것** | 하이패스 표기 수정은 **인쇄물 문구가 바뀌는 변경** — 기존 출력·보관본과 같은 데이터라도 표기가 달라진다(이전 것이 틀린 값). 별도 공지는 하지 않되 문의 시 이 Phase를 근거로 안내 |

---

### Phase 121: 처리방침 위탁·국외이전·보호책임자 조항 신설 · Greptile 코드리뷰 도입 📋🤖 (CI 배포 완료)

> 2026-07-28, 두 갈래다. ① 법정 필수 기재사항이 빠져 있던 개인정보 처리방침을 코드상 실제 연동 기준으로 재작성. ② Gemini Code Assist 종료(2026-07-22)로 비어 있던 머지 전 자동 리뷰 자리를 Greptile로 메움. 이 회차의 핵심은 조항을 늘린 것이 아니라, **문서가 코드보다 좁게 쓰여 있었다는 것을 두 번의 리뷰가 각각 다른 층위에서 찾아냈다**는 점이다 — 사람이 쓴 초안은 실제 데이터 흐름을 과소 기재했고, 봇은 그 수정본의 표기 불일치를 잡았다.

| 항목 | 내용 |
|------|------|
| **출발점** | 기존 방침은 Gemini만 언급하고 **처리위탁 수탁자 고지 자체가 없었다**. 제6조가 "제3자 제공 안 함"으로만 되어 있어 외부 이전이 없는 것처럼 읽혔으나, 실제로는 증빙서류가 Gemini로, 신청자 연락처가 Cafe24·알리고·Discord로 나간다. 개인정보 보호책임자 조항도 없었다(처리방침 필수 기재사항) |
| **제7조(위탁) 신설** | 코드상 실제 연동 9건을 수탁자·위탁업무·처리항목으로 공개(Firebase/Gemini/Gmail/Calendar, 알리고, Cafe24, Discord, Slack, Sentry). 목록은 `PROCESSORS` 배열 **단일 원본**으로 두고 선택 연동 수탁자는 `optional` 플래그로 구분 |
| **제8조(국외 이전) 신설** | 보호법 제28조의8 제2항 고지 항목 전부 기재(항목·국가·이용목적·문의처·시기/방법·보유기간·거부 방법). `OVERSEAS_PROCESSORS = PROCESSORS.filter(country !== '대한민국')`로 **파생**시켜 두 조항이 구조적으로 어긋날 수 없게 했다 |
| **제12조·기타** | 개인정보 보호책임자 조항 신설. 제6조에 위탁과 제3자 제공의 구분 문단 추가, 제3조 Gemini를 제7·8조로 연결, 제11조에 외부 연동 토큰 암호화 보관 항목 추가. 기존 제7~9조를 제9~11조로 재번호, 시행일 **2026-08-05** 및 개정 이력 표기 |
| **머지 전 적대적 리뷰 — 사실관계 오류 6건** | 초안을 독립 에이전트로 검토하니 **문서가 코드보다 좁았다**. ① `EmailJS Pte. Ltd.` 누락 — 기관 자동 승인 메일은 nodemailer가 아니라 EmailJS로 발송된다(`verifyHelpers.ts`). callable 경로만 nodemailer로 이관됐고 트리거 경로는 여전히 EmailJS. 법인 싱가포르·서버 미국(AWS)으로 확인해 국외 항목 포함 ② Gemini 처리 항목 확대 — 이미지 2종 외에 문의 본문·챗봇 질문 원문과 예약자 이름·일시·용도·목적지가 프롬프트로 전달(`generateFeedbackDraft`·`askAI`·`answerDataQuestion`) ③ Discord 확대 — `notifyRoleChange`가 이용자 이메일을, `generateFeedbackDraft`가 이름·이메일·기관명·문의 본문 전체를 웹훅으로 전송 ④ Slack에 이메일 추가(`users.lookupByEmail`로 계정 매칭) ⑤ Sentry에 이메일·기관 식별자 추가 — `setUser({id, email})`·`setTag('organizationId')`로 **명시 전송**되며 `beforeSend`는 PII를 제거하지 않는다 ⑥ 리전 문구를 Firestore로 한정 — `firebase.json`에 Storage 버킷 리전 설정이 없어 "Firebase 전체가 서울"은 근거 없는 서술이었다 |
| **국외 이전 거부 방법 분리** | 초안이 "이용 안 하면 미발생"으로 뭉쳐 있었으나, Discord·Sentry·Gmail·EmailJS는 **이용자가 회피할 수 없다**. '이용 안 하면 미발생'과 '개별 거부 불가'로 문단을 분리 |
| **Greptile 도입 — 앱 식별** | 같은 `greptileai` 조직이 GitHub 앱을 3개 운영해 혼동 구간이 있었다: `Greptile` OAuth 앱(프로필·이메일 read, 로그인 전용) / `greptile` GitHub App(**권한·이벤트 전무한 껍데기**) / **`greptile-apps`**(`pull_requests:write`·`checks:write`·`issues:write` + `pull_request`·`issue_comment` 이벤트 = 실제 리뷰 봇, 봇 계정 `greptile-apps[bot]`). 앞의 둘을 설치해도 리뷰는 돌지 않는다 — 첫 두 번의 `@greptileai` 트리거가 7분 무반응이었던 원인 |
| **Greptile 설정** | PR Summary·Sequence Diagrams OFF(1인 저장소에서 자기 코드 영어 요약은 무가치, `Update PR Description`은 한국어 PR 본문을 오염) / Issue Table·Confidence Score·**Comments Outside Diff** ON(diff 밖 파일까지 보는 코드베이스 인식이 도입 목적) / 접기 섹션은 `Default Open`(접힌 건 읽지 않는다) / Retrigger on new commits ON / 민감도 Medium / 결제 수단 **미등록** / 사용 데이터 학습 **OFF**(PR 본문에 공개 코드엔 없는 운영 맥락이 담긴다) |
| **Greptile 검증 — 두 경로** | ① 수동: `@greptileai` 멘션 → **220초** 후 리뷰 게시(COMMENTED + 인라인 2건) ② 자동: 새 커밋 푸시 → `Greptile Review` 체크가 **2m46s pass**로 붙음(추가 지적 없음). 커밋마다 재리뷰 설정이 실제로 동작함을 확인. 최근 머지 PR 10건의 커밋 수가 평균 1.5개(1·4·1·1·2·1·1·1·2·1)로 재리뷰 낭비가 작아 ON 유지가 타당 |
| **첫 리뷰 결과 — 1건 반영 / 1건 기각** | 둘 다 P2. **반영**: 제8조 국외 이전 목록에 제7조의 `기관 선택 연동 시` 배지가 빠져 Google Calendar·Slack이 상시 국외 이전 대상으로 보였다. `OVERSEAS_PROCESSORS`가 `PROCESSORS` 파생이라 `optional` 필드를 그대로 갖고 있어 제7조와 동일 분기를 추가(6줄). 각주가 설명하고 있었으나 법정 고지 문서에서 개별 항목 표기와 각주가 어긋나는 건 고칠 값이 있다. **기각**: React `key`를 `${p.name}-${p.task}` → `p.name`으로 줄이라는 제안. "이름이 이미 유일"은 현재 데이터 기준 사실이나, 같은 사업자명으로 위탁 업무가 하나 추가되면 키가 충돌한다 — 짧아지는 대신 방어력을 잃는 교환이라 무이득 |
| **민감도 판단 수정** | 정적 도구(ESLint·Prettier·commitlint·`local/require-organization-filter`)가 P2 영역을 이미 잡으니 Low가 맞다고 판단했으나, 실측에서 **유효한 지적이 P2로 분류**됐다. Low였으면 이 PR의 리뷰가 비었을 것 — Greptile의 P2가 실제 중요도보다 낮게 잡히는 경향이 보여 Medium 유지로 정정 |
| **비용 정책** | 저장소가 public + MIT라 OSS 프로그램(공개 저장소 + OSI 라이선스 무료) 대상이고 무료 티어(월 50리뷰)도 별도로 존재. OSS 무료를 약속받고도 과금된 사례 보고가 있어 **결제 수단은 등록하지 않았다** — 사고가 나면 조용한 결제가 아니라 결제 실패로 드러나야 한다. 트라이얼 14일 만료는 2026-08-11경 |
| **검증** | `tsc --noEmit` 0, pre-commit(ESLint `--max-warnings=0` + `vitest related`) 통과. 처리방침 전용 테스트는 없으며 표시 로직만 바뀌고 `PROCESSORS` 구조는 불변이라 회귀 범위는 이 페이지 렌더링에 한정. CI 7체크(`ci`·CodeQL 2종·`changes`·`preview`·`functions-tests` skip·`Greptile Review`) 1회 통과 |
| **커밋** | `30acd40`(squash) — 브랜치 `feat/privacy-consignment-notice` → PR #89. 내부 3커밋(`feat` 조항 신설 / `fix` 적대적 리뷰 6건 / `fix` Greptile 지적 1건). 총 293 insertions / 14 deletions, `PrivacyPage.tsx` 단일 파일 |
| **남은 것** | ① **GitHub App이 계정 저장소 41개(공개 20·비공개 21) 전부에 붙어 있다** — 월 50리뷰는 계정 합산이라 쿼터가 분산되고, 비공개 저장소는 커밋 이력에 시크릿이 있으면 그것까지 인덱싱된다(해제해도 벤더 인덱스는 되돌릴 수 없음). 연결 **전** 시크릿 점검 후 범위 축소 필요 ② OSS 프로그램 신청(트라이얼 만료 전) ③ Dependabot PR 리뷰 제외 — 주 4~5건으로 쿼터 최대 소비자인데 의존성 버전업에 AI 리뷰는 무가치. Greptile이 접근하는 것은 소스 코드뿐이고 이용자 데이터에는 닿지 않으므로 **처리방침 수탁자 추가 대상은 아니다** |

---

### Phase 122: E2E 플레이크 2계열 제거 — 접근성 포커스 · 예약 화면 무한 스피너 🧪🔍 (CI 배포 완료)

> 2026-07-30, PR을 반복 차단하던 E2E 실패 두 계열을 각각 근본 원인까지 파서 없앴다. 이 회차의 핵심은 수정 내용이 아니라 **진단 과정**이다 — ②에서 코드만 읽고 세운 가설이 틀렸고, CI 실패 아티팩트(trace·스크린샷·접근성 스냅샷)를 받아 보고서야 전혀 다른 원인이 드러났다. 로그가 아니라 **실패 시점의 화면 상태**가 답을 줬다.

| 항목 | 내용 |
|------|------|
| **① 접근성 포커스 (#94)** | `accessibility-advanced.spec.ts`의 "인터랙티브 요소에 키보드 접근" 테스트가 `waitForTimeout(2000)` 후 `Tab`을 눌러, 느린 CI에서 하이드레이션이 안 끝나면 포커스가 `body`에 남아 실패. 고정 대기를 인터랙티브 요소 가시성 대기 + `expect().toPass()` 재시도로 교체하고, **재시도마다 `blur()`로 포커스를 초기 상태로 되돌린다** — 안 되돌리면 2회차 Tab이 이미 이동한 지점에서 출발해 재시도가 무의미해진다. 커밋 `5cfc051`, PR #94, 16 insertions |
| **② 예약 승인 — 첫 진단이 틀렸다** | `authed-reservationApproval.spec.ts`가 CI에서 재시도까지 소진하며 실패. 코드만 보고 "`signIn`이 `void`로 완료를 안 기다린 뒤 하드 네비게이션 → Claims·리스너 준비 전 빈 목록"이라고 추정했으나 **오진**이었다. 앞서 `verify:full`을 파이프로 `tail`에 넘겨 **`tail`의 exit 0이 반환**되는 바람에 E2E 하드 실패를 통과로 오판한 사고도 있었다(이후 모든 검증 명령을 `> log 2>&1; echo "EXIT:$?"` 형태로 고정) |
| **② 아티팩트로 확정** | `gh run download`로 `e2e-failure-artifacts`를 받아 확인: 로그인·Custom Claims·Firestore가 **전부 정상**이고 사이드바 배지(차량 1·직원 2)까지 채워진 상태에서 **본문만 스피너**였다. 접근성 스냅샷의 `main`에는 상단 버튼 4개뿐. 트레이스 네트워크 254건 중 4xx/5xx **0건** — 모듈은 `PendingReservationList.tsx`까지 다 로드됐다. 결정적 단서는 콘솔의 `Fetching holidays for 2026 from public API as fallback` |
| **② 진짜 원인 (#96)** | `.env.emulator`에 `VITE_HOLIDAY_API_KEY`가 없고 `system/holidays`도 시드되지 않아 → `fetchPublicHolidays`가 **외부 실서비스**(`apis.data.go.kr`)로 Vite 프록시 폴백 → `useReservationData`가 그 fetch를 `Promise.all`로 **await** → `loading` 미해제 → `ReservationCalendar.tsx:49`가 스피너만 반환 → 승인/반려 목록이 **마운트조차 되지 않음**. CI 러너에서 공공데이터 API 응답이 늦으면 예약 화면이 영구 스피너였다 |
| **② 조치** | `seedHolidays`로 `system/holidays`를 시드. 프로덕션은 `monthlyBatch`가 이 문서를 채우므로 **Firestore 경로가 정상 경로**이고, 시드는 그 상태를 재현해 E2E를 외부 네트워크와 무관하게 만드는 것이다. 음력 공휴일(설날·추석)은 제외하고 날짜 고정 8건만 심어 연도가 바뀌어도 유효하게 했고, 러너(UTC)와 사용자(KST)의 연말 연도 엇갈림을 피해 올해+내년을 함께 심는다. 추가로 `openAdminReservations` 헬퍼가 제목을 먼저 단언해 **"화면이 로딩을 끝내지 못함"과 "행이 없음"을 구분**한다 |
| **② 검증** | `test:e2e:emulator` **11/11 통과(43.3s)**. 결정적 확인 — 예약 스펙만 재실행하며 브라우저 콘솔을 훑어 `Loaded holidays for 2026 from Firestore`를 확인(외부 폴백 **0회**), 2/2 통과(11.8s). 로컬 검증은 `git worktree` + node_modules 정션으로 격리 시도했으나 `.env.local`이 gitignore 대상이라 워크트리에 없어 Firebase 초기화가 실패했고(`__E2E_AUTH__` 미노출로 11건 전멸), 원인을 확인한 뒤 메인 트리에서 검증했다 |
| **Greptile 지적 기각** | "heading이 레이아웃 래퍼에 있어 스피너 중에도 통과할 것"이라는 P2. **사실이 아니다** — `<h1>차량 예약</h1>`은 `if (loading) return <spinner>` **뒤**에 있고, 실패 스냅샷의 `main`에 heading이 없는 것이 직접 증거다. 사이드바의 "차량 예약"은 `role=link`라 `getByRole('heading')`에 걸리지 않는다. 근거를 PR에 회신하고 수정하지 않았다 |
| **부수 발견 — 프로덕션 결함** | `system/holidays`에 해당 연도 데이터가 없는 **실사용자도 같은 무한 스피너**를 만난다(`Promise.all`이 외부 API를 무제한 대기). 이 PR 범위 밖으로 명시해 남겼다 |
| **커밋** | `5cfc051`(PR #94, 접근성) · `a4e92f8`(PR #96, 공휴일 시드 — 2파일 54 insertions). 둘 다 CI 그린 후 squash 머지, Deploy 완료 |
| **남은 것** | 위 프로덕션 무한 스피너(예약 화면이 외부 API 응답에 인질). Firestore 미스 시 폴백을 타임아웃·비차단으로 바꾸는 별건 |

---

### Phase 123: 접속기록 Phase 1 — 개인정보 변경 로그 서버 기록 🔐📋 (CI 배포 완료)

> 2026-07-30, "변경사항 로그·개인정보 열람 로그를 해야 하는지"라는 질문에서 출발해 의무를 판정하고 1단계를 구현했다. 결론은 **필수**다(규모 예외 없음). 이 회차의 핵심은 트리거를 만든 것이 아니라, **적대적 리뷰가 16건을 내면서 "무엇을 기록하지 않을 것인가"가 설계의 본체임을 드러냈다**는 점이다 — 블랙리스트에서 화이트리스트로 뒤집은 한 변경이 서로 무관해 보였던 세 결함을 동시에 없앴다.

| 항목 | 내용 |
|------|------|
| **의무 판정** | 법 제29조 + 시행령 제30조 → 고시 「개인정보의 안전성 확보조치 기준」 제16조(접속기록의 보관 및 점검). **규모 예외 없음** — 1만명 미만 소상공인·단체는 *내부관리계획*을 생략할 수 있으나 접속기록은 생략 대상이 아니다. 보관 **1년**(2년 요건인 정보주체 5만명·고유식별정보·민감정보 어디에도 해당하지 않음) |
| **왜 트리거인가** | 클라이언트가 기록하면 로그를 남기지 않고 조작하는 우회가 가능하다. Firestore 트리거는 쓰기가 곧 이벤트이므로 클라이언트가 건너뛸 수 없고 Admin SDK로 쓰므로 위조도 못 한다. 기존 `syncDriveLogKm`에 얹지 않은 이유는 감사 쓰기 실패가 차량 누적 Km 동기화라는 핵심 로직까지 죽이기 때문 |
| **화이트리스트 전환 — 한 변경이 세 결함을 없앴다** | 초안은 "메타 필드만 제외"하는 블랙리스트였다. `AUDITED_FIELDS`(개인정보 필드 + 접근 권한 필드)로 뒤집으니 ① **연쇄 증폭**(아래) ② **필드명 오염** — `driveLogs` create 규칙에 `hasOnly`가 없어 임의 이름의 필드를 넣을 수 있고 그 이름이 그대로 `changedFields`에 들어와, 필드명에 개인정보를 담아 **삭제 불가능한**(`allow write: if false`) 컬렉션에 1년간 박아 넣는 경로가 열려 있었다 ③ **UI 선호 기록** — 다크모드 토글·환영 배너 닫기·FCM 토큰 회전이 전부 감사 1건이었다(개인정보 처리 행위가 아니므로 최소수집에 반하고 점검 화면만 어지럽힌다). 세 개가 한 번에 사라졌다 |
| **연쇄 증폭 발견 (기존 결함)** | `syncNextLogStartKm`의 `MAX_CHAIN = 20`은 **한 번의 호출만** 제한하고 연쇄를 막지 못한다. 20번째 문서의 `update`가 `onDriveLogUpdated`를 재발동하고, 그때 21번째 문서의 `startKm`은 아직 구 값이라 `oldStartKm === carryKm` break에 걸리지 않아 21~40을 또 쓴다 — 20건 단위 파도로 해당 차량 이후 전체에 전파된다. 기록 1,000건 차량의 km 1 정정이 쓰기 ~1,000건 + 호출 ~2,000회가 된다. PR이 근거로 든 "하루 1,000건"은 **사람의 행위 수**였다. km은 차량 자산 데이터이지 개인정보가 아니므로 화이트리스트에서 자연히 빠져 감사 로그는 이 증폭을 복제하지 않는다. **증폭 자체는 미수정 — 별도 PR로 이연** |
| **유실 대책 — retry + 멱등** | v2 Firestore 트리거 기본값이 `retry: false`라 실패 이벤트가 폐기되는데, `catch`가 모든 실패를 삼켜 법정 기록이 조용히 사라졌다. 게다가 `add()`는 매번 새 ID라 retry를 켜면 중복이 생겨 **켤 수도 없는 구조**였다. 문서 ID를 `대상타입_대상ID_이벤트ID`로 고정하고 `retry: true`, 실패는 ERROR 로그 후 **다시 throw**해 재전달에 맡긴다. 트리거는 커밋 이후 실행되므로 원본 쓰기를 되돌리지 않는다 |
| **superAdmin 감시 사각지대** | `organizationId`가 없으면 기록을 건너뛰었다 → **시스템 전체 권한 계정의 생성·권한 변경·삭제가 한 줄도 남지 않았다**. `'__system__'`으로 남긴다 — 실재하지 않는 기관 ID라 `isOrgAdmin`이 성립하지 않아 superAdmin만 조회한다(Rules 테스트로 기관 관리자 2명 차단 실증) |
| **행위자 오기재 (restoreUser)** | 사용자 문서 생성을 무조건 본인 행위 + `actorSource: 'document'`로 확언했다. `restoreUser`는 관리자가 **타인** 문서를 재생성하므로 무고한 사용자에게 책임이 귀속되고, 이는 `unknown`보다 나쁘다 — 모른다고 남기는 게 아니라 **틀린 행위자를 확언**하는 것이다. `restoredAt`으로 두 경로를 가른다 |
| **보관기간 근거 정정 (사실오인)** | 타입 주석에 "탑승자란에 이용자 이름을 기록하지 않으므로 1년"이라고 썼으나 `driveLogValidation.ts:146`이 **`passengerNames`를 실제로 저장**한다. 결론(1년)은 고유식별정보·민감정보 미수집 + 5만명 미달로 유지되지만 근거를 다시 썼다. 탑승자를 `subjectUids`에서 제외한 판단(uid 없이 이름만 저장돼 넣으면 감사 로그가 이름을 담게 된다)도 명시 |
| **적대적 리뷰 16건 — 반영/기각** | 반영: 위 6건 + 배럴 미등록(`schemas/auditLog.ts`가 스스로 "스키마 누락 결함을 겪었다"고 경고하면서 정작 배럴에 없어 Phase 3에서 재발할 배치였다) · 스키마 `at`·`expiresAt` 필수화(`AuditLog` 타입과 상호 대입 불가) · `organizationId+at` 복합 인덱스 + `changedFields` 색인 면제 · Rules 주석 축소(Admin SDK는 Rules를 우회하므로 제16조 ③ 충족 주장은 과했다) · MONITORING_GUIDE 감사 실패 알림 룰. 기각·이연: `archiveDriveLogs` 대량 삭제 폭발(최초 커밋 2026-03이라 3년 초과 문서 없음) · MAX_CHAIN 증폭 자체(별건) · 서버 측 불변성(불변 버킷·Logging 싱크급, 범위 밖) |
| **Greptile 지적** | P2 1건 — `auditDriveLogUpdated`의 `organizationId`가 `after`만 봐서 `auditUserUpdated`와 불일치. `orgIdOf(...candidates)`로 뽑아 통일. 반영분 재리뷰(5m43s)에서 추가 지적 없음 |
| **테스트 14 → 30건** | 기존 테스트가 회귀를 못 잡던 지점을 메웠다: `expiresAt`이 `toBeDefined()`뿐이라 **`RETENTION_DAYS`를 1로 바꿔도 통과**했고(→ `Timestamp.fromMillis` 인자를 365일 범위로 단정), `index.ts` export를 지워도 전부 통과했고(→ 소스를 읽어 6개 이름 고정, CLAUDE.md 절대 규칙 #3), `toMatchObject`가 추가된 키를 못 잡았다(→ **키 집합 자체를 단정**해 값 필드가 끼어들면 실패). `capturedDocPaths`가 대입만 되고 단정이 없던 죽은 변수도 해소. 화이트리스트 동작(km 연쇄·UI 선호·임의 주입 필드 각각 미기록), superAdmin 경로 3건, 순환 참조 내성 추가 |
| **검증** | `verify:full` 전체 통과 — 프론트 94파일/965건, **Functions 52 suites/548건**(518 → +30), Rules 16건, 비인증 E2E 67건, 에뮬레이터 E2E 11건. CI 7체크 통과(`ci` 5m24s · `functions-tests` 9m58s · CodeQL 2종 · `changes` · `preview` · `Greptile Review`) |
| **배포·프로덕션 실증** | 커밋 `8203792`(PR #95, 12파일 953 insertions). Deploy 4m31s에 트리거 6개 전부 `asia-northeast3` create 성공. **10:41 배포 → 10:43:49 첫 기록** — 2분 만에 실사용 트래픽을 잡았다. 같은 일지의 create(10:46:59)/update(10:47:45) 쌍에서 `changedFields`가 **`["destination"]` 하나뿐** — 함께 쓰인 `editedAt`과 화이트리스트 밖 필드가 정확히 제외됐다. `expiresAt`은 `at` + 365일이 **초 단위까지 일치**(10:47:45 → 2027-07-30 10:47:45). update의 `actorUid`는 `null` + `actorSource: 'unknown'`으로, 46초 전 작성자와 동일인일 가능성이 압도적이지만 추정으로 채우지 않았다 |
| **배포 후 수동 작업** | GCP 콘솔 TTL 정책 설정 완료(컬렉션 그룹 `auditLogs`, 필드 `expiresAt`). 정책 없이는 `expiresAt`이 채워져도 아무것도 삭제되지 않아 **보관기간 경과분 미파기 = 최소보관 원칙 위반**이 된다. 안내 URL을 `/time-to-live`로 잘못 적었던 것을 실제 경로 `/ttl`로 정정 |
| **역할별 체감 변화 — 없다** | superAdmin·기관 관리자·직원 모두 화면 변경 0건. 관리자는 Rules상 읽기 권한만 생겼고 조회 화면은 Phase 3, 직원은 명시적 읽기 차단(점검 주체가 아니다). 트리거는 커밋 이후 비동기라 저장 체감 속도에도 영향이 없다. 달라진 것은 사용자 경험이 아니라 **기관의 법적 지위**다 |
| **시한 표현 정정** | Phase 3 시한을 "2026-10-29"로 표현했으나, 정확히는 **월 1회 이상 점검 의무가 2026-10-30부로 폐지**되고 내부관리계획상 자율 주기로 바뀌는 날짜다. 그날까지 조회 화면이 없으면 위법이 되는 마감이 아니고, 이후엔 오히려 압박이 줄어든다 |
| **남은 것 — Phase 2 범위 재조정** | 제16조가 요구하는 항목은 계정·일시·**접속지(IP)**·정보주체·수행업무인데 Phase 1은 일시·정보주체·수행업무만 채웠다(계정은 수정·삭제에서 공백, IP는 전무). 원래 계획한 **전면 열람 로그는 하지 않기로** 했다 — 로그가 원본보다 커지고 실질 위험은 개별 조회가 아니라 반출에 있다. 대신 ① **행위자 스탬프**: `lastEditedByUid` + Rules `request.resource.data.lastEditedByUid == request.auth.uid`로 **위조 불가하게 강제**(클라이언트가 심는 값인데도 인증 토큰과 일치를 Rules가 보장하므로 콜러블 이관·오프라인 큐 변경이 불필요) ② **세션 기록 콜러블**: 로그인 시 1회 uid·IP·UA(트리거는 IP를 볼 수 없다) ③ **반출 기록**: 엑셀·PDF 내보내기, 직원 목록 일괄 조회, superAdmin 타 기관 접근. ①② 2시간이면 항목 요건이 채워진다. 우선순위는 **#91~#93 머지(시행일 2026-08-05 고정) 이후** |

---

### Phase 124: 공개 문서 현행화 — README·셀프호스팅·Functions 레퍼런스 📄 (문서 전용)

> 2026-07-30, "GitHub 저장소에 갱신할 게 있을까"라는 질문에서 출발해 공개 문서를 코드와 대조했다. 결과는 **낡음이 아니라 오류**였다 — 셀프호스터가 가이드를 그대로 따르면 티맵 경로 탐색이 안 되고, App Check를 켤 수 없고, `functions/.env`를 예시대로 채우면 **배포가 거부**된다. 문서를 사람이 손으로 쓰면 코드와 어긋난다는 일반론이 아니라, **어긋난 지점이 전부 "설정값"이라는 한 종류**였다는 게 이 회차의 발견이다.

| 항목 | 내용 |
|------|------|
| **환경변수 이름 오류 (A급)** | README·SELF_HOSTING이 `VITE_TMAP_APP_KEY`를 요구하는데 코드는 `VITE_TMAP_API_KEY`를 읽는다. 이름이 다르면 값을 정확히 넣어도 앱 내 경로 탐색·톨비가 조용히 비활성 — 에러도 안 난다 |
| **App Check 사이트 키 미기재** | `firebase.ts:73`이 `VITE_RECAPTCHA_SITE_KEY`로 `ReCaptchaV3Provider`를 초기화하는데 두 문서 어디에도 이 변수가 없었다. SELF_HOSTING §7은 "reCAPTCHA v3 등록"까지만 안내해, 등록하고 나서 **키를 넣을 곳을 모르는 상태**로 끝났다 |
| **`functions/.env` 예시가 배포를 깨뜨렸다** | README가 `EMAILJS_PRIVATE_KEY`·`ALIMTALK_PROXY_TOKEN`을 `.env`에 쓰라고 안내했으나 둘은 `defineSecret`(Secret Manager) 대상이다. `params.ts` 주석대로 **같은 키가 `.env`에 남아 있으면 이름 충돌로 배포가 거부**된다. 예시를 따르는 것이 실패 조건이었다. Secret 8종(`GMAIL_APP_PASSWORD`·`EMAILJS_PRIVATE_KEY`·`ALIMTALK_PROXY_TOKEN`·Slack 5종) `functions:secrets:set` 절차를 신설하고, 선택 기능이라도 **시크릿 미등록 시 그 함수의 배포가 실패**한다는 경고를 SELF_HOSTING에 추가 |
| **프론트 변수 목록 정정** | 미사용 `VITE_EMAILJS_*` 3종 제거(EmailJS는 Functions 전용으로 이관됨), 누락된 `VITE_FIREBASE_MEASUREMENT_ID` 추가, 개발 전용(`VITE_APPCHECK_DEBUG_TOKEN`·`VITE_USE_EMULATOR`)은 `.env.local`로 분리 명시 |
| **Functions 레퍼런스가 22개를 몰랐다** | `generate-functions-doc.ts`의 카탈로그는 "자동 생성"이라는 머리말과 달리 **수동 배열**이라 47개에 멈춰 있었다. 누락 22개(Slack 8·감사로그 6·운행일지 트리거 3·`withdrawOrganization`·`deleteUserPermanently`·`backfillMonthlyStats`·`triggerOnDemandCalendarSync`·`dailyNightlyBatch`), 반대로 **존재하지 않는 7개**(`backupFirestore`·`autoPurgeOrgs`·`archiveDriveLogs`·`cleanupCertificateImages`·`verifyMileageConsistency` → 배치로 통합, `updateAggregatedStats` → `syncDriveLogKm`으로 흡수, `scheduledDiscordBriefing` → 제거)를 계속 문서화하고 있었다. 파일 경로도 전부 `handlers/` 이전 값이라 `functions/src/ocrDashboard.ts`처럼 **없는 경로**를 가리켰다 |
| **스케줄 주기가 셋 다 틀렸다** | README는 `reservationReminder`·`syncCalendarToApp`을 "10분"으로, 카탈로그는 "15분"·"2시간"으로 적었다. 실제는 `0 8-18 * * 1-5`(평일 08~18시 매시)와 `0,30 6-22 * * 1-5`(평일 06~22시 30분). 비용 절감으로 주기를 늘린 변경이 문서에 반영되지 않은 것 |
| **정합성 검증 방식** | `index.ts`의 export 이름 집합과 카탈로그 `name` 집합을 `comm`으로 대조해 **63 = 63 완전 일치** 확인. README의 종류별 개수(onCall 34·onRequest 4·onSchedule 5·Firestore 19·Auth 1)도 생성된 문서의 섹션 카운트와 맞췄다 |
| **README 구조 변경** | 함수 4개 표(28개만 나열)를 종류별 요약 + [FUNCTIONS_REFERENCE.md](../FUNCTIONS_REFERENCE.md) 링크로 대체 — 같은 목록을 두 곳에서 손으로 유지하는 구조 자체가 낡음의 원인이었다. 배포 절에서 로컬 `firebase deploy` 안내를 CI 단일 경로로 교체(CLAUDE.md와 모순이었다), 셀프호스터용 경로는 별도 링크로 분리. `src/contexts/`(삭제됨) → `src/schemas/`, 주요 기능에 Slack·AI 도움말·보안 3행, 기술 스택에 App Check·Slack 2행 추가 |
| **테스트 규모 실측 갱신** | 표기 49파일/357건 → **94파일/965건**, Functions 19 suites/172건 → **52 suites/548건**, Rules 1파일 → Firestore 16 + Storage 6건, E2E 18 → 24 spec. grep 근사치가 아니라 `npm test`·`test:functions`를 실제 실행해 얻은 값 |
| **검증** | ESLint 0 · `tsc --noEmit` 0 · 하네스 Doctor 12영역 0오류. 생성기 재실행으로 문서 재생성(63개). 블록인용 머리말이 trailing space 두 칸에 의존해 줄바꿈되던 것을 `>` 빈 줄 분리로 바꿔 렌더링 깨짐 여지를 없앴다 |
| **하지 않은 것** | 공개 전환(2026-07-18) 이전 내부 산출물(`progress.md`·`ORIGINAL_REQUEST.md`·`로그인문제해결계획서_v4.2.md`·`docs/2026-07-10코덱스평가*.md`·`docs/개선계획서_*.md`)의 정리·아카이빙은 보류 — 기능 영향이 없고, "실제 프로덕션 레퍼런스"라는 공개 목적에는 오히려 자료가 된다. 카탈로그 드리프트를 CI에서 막는 `index.ts` 대조 가드도 별건으로 남겼다(이번엔 수동 대조로 확인) |

---

### Phase 125: 카탈로그 드리프트 CI 가드 + 내부 문서 아카이브 🛡️📦 (문서·하네스)

> 2026-07-30, Phase 124가 "별건으로 남긴다"고 적어둔 두 건을 이어서 처리했다. 핵심은 아카이빙이 아니라 **가드**다 — 124는 벌어진 격차(47 vs 63)를 손으로 메웠을 뿐이고, 같은 낡음이 재발하는 것을 막지는 못했다. 문서가 낡는 것을 **문서 규율이 아니라 실행 가능한 검사**로 옮겼다.

| 항목 | 내용 |
|------|------|
| **드리프트 가드 (하네스 Doctor 13번)** | `scripts/check-harness.ts`에 검사 1개 추가 — `generate-functions-doc.ts` 카탈로그의 `name` 집합과 `functions/src/index.ts` export 집합을 **양방향** 대조한다. 배포되는데 문서에 없는 함수(추가 누락)와 문서에만 남은 함수(삭제 누락)를 각각 오류로 잡고, 중복 항목도 검사한다. `verify:harness`가 CI(`harness-ci.yml`)에서 돌므로 CLAUDE.md 절대 규칙 #3(`index.ts` 등록 필수)과 같은 층에서 강제된다 |
| **"고치고 재생성 안 함"도 잡는다** | 카탈로그만 수정하고 생성기를 돌리지 않으면 배열은 맞는데 문서가 낡는다. 생성 문서의 `총 함수 수: **N개**` 표기와 배열 길이를 비교해 이 경우를 오류로 만든다. 형식 표기를 못 찾으면 경고(생성기 출력 형식 변경 감지) |
| **파서를 순수 함수로 분리** | `extractFunctionExports`(한 줄·여러 개·여러 줄 `export {}` + `as` 별칭은 배포 이름 쪽을 취함) / `extractCatalogNames`(설명 문자열 안의 `name:` 가짜 표기를 `^\s*name:` 앵커로 배제)를 export해 단위 테스트 대상으로 만들었다. 이 파일의 기존 헬퍼 관례를 따른다 |
| **가드 실효성 실측** | 카탈로그 항목 하나를 `askAI` → `askAI_TYPO`로 바꿔 뮤테이션 — **양방향 2건**("카탈로그에 없는 배포 함수: askAI" / "index.ts에서 export되지 않는 카탈로그 항목: askAI_TYPO")이 잡히고 exit 1. 원복 후 0건. Phase 119의 "revert해도 CI 그린이던 공백"을 반복하지 않기 위한 확인 |
| **테스트 14 → 22건** | 파서 7건(여러 줄 export·별칭·import 오탐 방지·설명 안 가짜 `name:` 배제·따옴표 스타일) + 드리프트 판정 4건. 판정 자체를 테스트로 고정해 비교 방향 하나를 지워도 실패한다 |
| **Greptile 지적 2건 — 둘 다 반영** | ① **따옴표 하드코딩**: `extractCatalogNames`가 작은따옴표만 받아, 카탈로그가 큰따옴표로 재포맷되면 파서가 빈 배열을 내고 **전 함수 누락으로 오탐해 CI를 잘못 막는다**. 가드가 차단기로 뒤집히는 실패 모드라 `['"\`]`로 확장하고 큰따옴표 변환 시뮬레이션으로 0오류 확인. 더해 파서가 통째로 실패하는 경우(양쪽 중 하나라도 0건)를 **드리프트가 아니라 파서 문제로 따로 보고**하게 했다 — 원인 오독을 막는다 ② **판정 테스트가 재구현을 검증**: 테스트가 로컬 클로저를 검사해 본체를 지워도 통과할 수 있었다(Phase 119와 같은 종류의 공백) → `diffCatalogNames`를 export해 13번 검사와 테스트가 **같은 함수**를 쓰게 했다 |
| **내부 문서 아카이브** | 공개 전환(2026-07-18) 이전 산출물 8개를 `docs/archive/`로 이동: `ORIGINAL_REQUEST.md`·`PROJECT.md`·`로그인문제해결계획서_v4.2.md`(루트) + 코덱스평가 2건·개선계획서 3건(docs). 지우지 않은 이유는 당시 판단 근거로서의 가치이고, 옮긴 이유는 **저장소를 처음 보는 사람이 낡은 계획서를 현재 상태로 오독하는 것**을 막기 위해서다. `docs/archive/README.md`에 "지금 볼 곳" 표와 보관 문서별 성격을 두고, **잔여 항목이 있는 문서를 명시**했다(개선계획서_2026-07: Functions `enforceAppCheck` 단계 강제) — 아카이빙으로 열린 항목이 묻히는 것이 이 작업의 유일한 실질 위험이었다 |
| **`progress.md`는 대상이 아니었다** | Phase 124 기록에 공개 노출 대상으로 적었으나 `.gitignore:109`에 있어 **애초에 공개되지 않는다**. 이동하지 않았다 |
| **이동이 깨뜨린 링크 복구** | 상대 경로 기준이 바뀌므로 인바운드 5곳(구현계획서 1·security-reports 2·트랙B_Phase82-102 5개 링크)을 새 경로로 고치고, 아카이브 문서가 밖을 가리키던 링크 30곳을 스크립트로 복구(`../README.md` → `../../README.md` 등). 저장소 전체 마크다운 상대 링크를 스캔해 48건 → **6건**으로 줄였다. 남은 6건은 이번 변경과 무관한 기존 로트(`security-reports/2026-06-26.md` 5건, `트랙B_Phase49-81.md`의 `rules` 1건)로 손대지 않았다 |
| **부수 수확** | 트랙B_Phase82-102의 `개선계획서_2026-07.md` 링크 4곳은 2026-07-25 이력 분할 때부터 **이미 깨져 있었다**(docs/구현이력/ 기준으로 해석돼 존재하지 않는 경로). 이동 대응 과정에서 함께 정상화 |
| **검증** | 하네스 Doctor **13개 영역 0오류 0경고** · `check-harness.test.ts` 20건 통과 · ESLint 0 · tsc 0. 이동은 `git mv`라 이력이 보존된다 |

---

### Phase 126: km 연쇄 동기화 증폭 제거 — 가짜 상한을 실제 상한으로 🔧⚡ (커밋·PR)

> 2026-07-30, Phase 123에서 발견해 "별건 이연"으로 남겨둔 결함을 처리했다. 핵심은 상한을 키운 것이 아니라 **연쇄가 트리거를 타고 번지던 경로를 끊은 것**이다. 그리고 그 경로를 끊자 **거기에 얹혀 우연히 동작하던 기능(차량 누적 km 보정)이 드러났다** — 이번 회차에서 가장 조심해야 했던 지점이다.

| 항목 | 내용 |
|------|------|
| **문제 — 상한이 가짜였다** | `syncNextLogStartKm`은 문서 1건씩 `update`하며 `MAX_CHAIN = 20`에서 멈췄다. 그런데 그 update가 `onDriveLogUpdated`를 재발동하고, 20번째 문서의 트리거가 다시 21~40번째를 갱신하는 식으로 연쇄가 **트리거를 타고 계속됐다**. 상한은 한 호출만 제한했을 뿐 전체를 막지 못해, 기록 1,000건 차량의 km 1 정정이 쓰기 ~1,000건 + 함수 호출 ~2,000회가 됐다. 게다가 파도마다 같은 구간을 다시 조회하고, 문서마다 통계 핸들러·감사 트리거가 헛돌았다 |
| **조치 ① 한 호출에서 끝까지** | 페이지(200건) 단위로 조회해 `WriteBatch`로 커밋하며 꼬리 끝까지 처리한다. 커밋 횟수가 문서 수만큼이 아니라 페이지 수만큼으로 줄어든다(22건 → 커밋 1회, 테스트로 고정) |
| **조치 ② 재발동 차단** | 연쇄 쓰기에 `kmSyncRev`를 `increment(1)`로 올리고, `onDriveLogUpdated`는 이 값이 변한 update를 **즉시 반환**한다. 사람의 편집은 이 필드를 건드리지 않으므로 구분이 확실하다. 호출·조회가 O(N) → O(1)이 된다 |
| **조치 ③ 상한은 실제 상한으로** | 이제 상한(1,000건)이 진짜 멈춘다는 뜻이라, 넘으면 데이터가 어긋난 채 남는다. 그래서 마지막 문서에 `kmSyncContinue`를 남기고 종료하고, 그 문서의 트리거가 이어받는다 — **완결성을 유지하면서** 이어받기 호출은 1,000건마다 1회뿐이다. 운행일지는 감사 대상 기록이므로 조용한 부분 반영은 선택지가 아니었다 |
| **함정 — 이어받기 표시는 rev와 함께 올려야 한다** | 표시만 쓰면 `kmSyncRev`가 그대로여서 트리거가 "마일리지 필드 미변경"으로 조기 반환하고 **이어받기가 죽는다**. 표시 쓰기에 rev 증가를 함께 넣어 연쇄 분기로 들어가게 했다. 또 같은 배치에서 같은 문서를 두 번 쓰는 것에 의존하지 않도록 커밋 후 별도 1회 쓰기로 분리했다(1,000건당 1회) |
| **끊고 나서 드러난 의존 — currentKm** | 예전에는 연쇄의 **마지막 문서 update가 "최신 기록 수정"으로 판정돼 차량 `currentKm`을 우연히 보정**했다. 재발동을 끊으면 그 경로가 사라져 소급 삽입·중간 삭제 후 누적 km이 틀어진다. `applyChainCurrentKm`으로 명시화 — 연쇄가 최신 기록까지 닿았을 때만(`reachedEnd`) 마지막 문서의 endKm 변화량으로 증분하고, 차량의 기관 소속을 검증한다(교차 테넌트 오염 차단). 최신 기록을 직접 수정한 경우는 기존 분기가 이미 증분하고 연쇄 대상이 없어 delta가 0이라 이중 계상되지 않는다 |
| **죽은 사본 제거** | `src/lib/firestore/driveLogs/utils.ts`에 같은 이름·같은 결함의 클라이언트 구현이 있었고 배럴 3곳으로 export돼 있었으나 **호출부는 0건**이었다(`SyncResult` 타입도 미사용). 고친 사본과 안 고친 사본을 함께 두면 나중에 누가 후자를 불러 재발한다 — 함께 제거해 구현을 하나로 만들었다 |
| **기존 테스트가 버그를 정답으로 고정하고 있었다** | `연쇄는 최대 20건까지만 전파한다(무한 루프 방지)`는 테스트가 있었다. 의도는 방어였지만 실제로는 **절단을 계약으로 굳혀** 놓은 것이라, 20건 초과 전파·상한 도달 시 이어받기로 교체했다. 이런 테스트는 통과할수록 문제를 가린다 |
| **테스트 6 → 14건** | 전 구간 전파(22건, 커밋 1회) · rev 표시 동반 · 상한 도달 시 이어받기 표시 · 연쇄 update 무부수효과 · 이어받기 재개 및 표시 해제 · 사람 수정은 정상 경로 · 소급 삽입 currentKm +delta · 중간 삭제 currentKm −delta. **가드 뮤테이션 실측**: 재발동 차단 조건을 `false`로 바꾸면 2건 실패(원복 후 13/13) |
| **Greptile 지적 반영 — 순서가 안전장치였다** | 이어받기 표시를 재정합 **전에** 지우고 있었다. 도중에 함수가 죽으면(타임아웃·OOM) 표시가 사라져 1,000건 이후가 조용히 방치되는데, 이 트리거는 `retry: false`라 이벤트 재전달도 없어 복구 근거가 아예 없어진다. 표시 해제를 재정합 **뒤로** 옮겼다 — 남겨두면 재개 근거가 유지되고, 중복 실행은 멱등이라 해롭지 않다(같은 값으로 수렴하고 두 번째는 `stoppedConsistent`로 즉시 종료). 순서 자체를 테스트로 고정했다(쓰기 순서가 `C` → `B:clear`) |
| **검증** | Functions 52 suites/**556건**(548 → +8) · 프론트 94파일/974건 · ESLint 0 · tsc 0(프론트·Functions) |
| **남는 것 — 쓰기 건수 자체** | `startKm`이 앞 기록의 `endKm`을 비정규화해 들고 있으므로, 과거 km 정정이 뒤 기록 전부를 다시 쓰는 것은 모델상 불가피하다. 줄인 것은 **호출·조회·중복 파도**다. 동일 timestamp 형제 문서를 커서가 건너뛰는 기존 한계도 그대로다(문서 수 상한이 있어 폭주는 아니다) |
| **배포 시 주의** | 배포 순간 구버전 호출이 남아 rev 없이 쓴 문서가 있으면 신버전 가드가 "사람 편집"으로 보고 연쇄를 한 번 더 돌린다. 결과는 동일 값으로 수렴하므로(멱등) 안전하다 |

---

### Phase 127: Google 로그인 계정 전환 불가 수정 — prompt=select_account 🔐 (커밋·PR)

> 2026-07-31, 사용자 문의로 확인했다. 스마트폰에서 "다른 계정으로 로그인"을 눌러도 직전 구글 계정으로 다시 들어가진다는 신고였다. **버튼이 실제로 하는 일과 사용자가 기대하는 일이 어긋나 있었다.**

| 항목 | 내용 |
|------|------|
| **증상** | 모바일에서 계정1로 로그인된 상태에서 계정2로 바꾸려고 "다른 계정으로 로그인"을 눌러도, 다시 계정1로 로그인된다 |
| **원인 — 앱이 끊을 수 없는 세션** | `googleProvider`에 커스텀 파라미터가 없어 `prompt` 미지정 상태였다. 이러면 Google은 브라우저에 활성 세션이 **하나뿐일 때 계정 선택 화면을 건너뛰고** 그 계정으로 바로 인증시킨다. 앱의 `logout()`은 Firebase 세션·오프라인 큐·Firestore 캐시를 지우지만 **Google 쪽 브라우저 세션은 지울 수 없다**(권한도 범위도 밖). 그래서 [InviteCodePage](../../src/components/auth/InviteCodePage.tsx)의 "다른 계정으로 로그인" 버튼은 로그아웃까지만 하고, 이어지는 `signInWithRedirect`가 같은 계정을 조용히 되돌려놨다 |
| **조치** | `googleProvider.setCustomParameters({ prompt: 'select_account' })` 한 줄. 활성 세션 수와 무관하게 매 로그인마다 계정 선택 화면을 강제한다. 로그인 진입점은 `src/lib/auth.ts` 하나뿐이고 popup/redirect 분기 모두 같은 provider를 쓰므로 한 곳만 고치면 된다 |
| **부수 효과 — 오히려 이득** | 기관 공용 기기(차량 운행일지 특성상 흔하다)에서 직전 사용자 계정으로 무의식 재로그인되던 것도 함께 막힌다. 비용은 재로그인 시 계정 클릭 1회 |
| **안 한 것** | `prompt: 'consent'`는 매번 권한 동의 화면까지 띄워 과하다(계정 선택만 필요). redirect/popup 분기, `handleRedirectResult` 경로는 그대로 뒀다 |
| **설치형 PWA(standalone)** | 인증 경로에 display-mode 분기가 없어(standalone 참조는 InstallPrompt·useBackButton뿐) 설치형도 브라우저와 **같은 코드·같은 리다이렉트 흐름**을 탄다. 이 변경은 Google이 보여줄 화면만 바꾸므로 리다이렉트 복귀 메커니즘은 그대로다 — 계정 선택 화면이 한 번 더 뜰 뿐이다 |
| **검증** | ESLint 0 · tsc 0 · 프론트 94파일/974건(tmap 1건은 병렬 워커 타임아웃 플레이크, 단독 재실행 11/11 통과) · 프로덕션 빌드 통과. Google 계정 선택 화면 자체는 외부 도메인이라 E2E로 덮을 수 없어 배포 후 실기기 확인이 남는다 |
| **배포 전 문의자 안내** | 크롬 시크릿 탭으로 접속하거나, `accounts.google.com`에서 로그아웃 후 재로그인하면 계정 선택 화면이 나온다 |

---

### Phase 128: 한 사람의 동시 다중 차량 예약 차단 제거 — 클라이언트만 서버·FAQ와 어긋나 있었다 🚗 (수동 배포·PR)

> 2026-07-31, 사용자가 화면 캡처와 함께 "이 문제는 해결이 된 것 아닌가"라고 물어왔다. **답은 둘 다였다** — 코드는 고쳐져 있었고, 커밋되지 않아 배포되지 않았다.

| 항목 | 내용 |
|------|------|
| **증상** | 예약 화면에서 한 사람이 같은 시간대에 두 번째 차량을 예약하면 `같은 시간대에 2대의 차량을 예약할 수 없습니다.` 토스트로 차단 |
| **1차 원인 — 세 곳의 정책이 어긋나 있었다** | 클라이언트 `handleSubmit`만 사용자 단위 겹침(`findUserOverlappingReservation`)을 검사했다. 서버 코어 `createReservationCore`는 `organizationId + vehicleId + date` 기준 겹침만 보고 `reservedByUid`는 판정에 쓰지 않으며(`modifyReservationCore`도 동일), [FAQ](../../shared/faqData.ts)의 `multiple-reservations-same-time` 항목은 "한 분이 같은 시간대에 각기 다른 여러 대의 차량을 동시에 예약하시는 것은 전혀 막지 않습니다"라고 **이미 안내 중**이었다. 행사·대규모 외근처럼 한 사람이 여러 대를 잡아야 하는 상황을 클라이언트가 단독으로 막고 있었다 |
| **2차 원인 — 고친 코드가 배포되지 않았다** | 수정이 워킹트리에만 있었다. 커밋조차 없어 master에도, 프로덕션에도 반영되지 않은 상태였다. 사용자는 "고쳤다"고 기억했고 실제로 파일은 고쳐져 있었으므로, **로컬 수정과 배포 상태의 간극이 그대로 미해결 버그로 남아 있었다** |
| **조치** | `handleSubmit`에서 사용자 단위 검사 호출과 차단 분기 제거. 차량 기준 겹침 검사(`findOverlappingReservation`)는 그대로 유지 |
| **남는 방어선** | 생성 경로는 서버 트랜잭션 단일이다 — `createReservationSafe`는 콜러블 전용이고 직접 쓰기 폴백이 없으며, `firestore.rules`가 일반 사용자의 reservations 직접 create를 막는다. 서버는 차량 문서 락(`_lastReservationLock`) + 트랜잭션으로 차량 기준 겹침을 실제로 거부(`already-exists`)한다 |
| **다일·반복 경로** | 제거된 블록은 원래 `if (userOverlap && !isRecurring)`이라 반복 예약에선 이미 무력이었다. `isMultiDay`·`isRecurring`·`editingReservation`은 계속 쓰이고, 함께 제거된 `targetUid`는 그 블록 전용 지역 변수였다 |
| **테스트가 허수였다 — 리뷰 지적 반영** | 처음 쓴 "차단하지 않는다" 테스트는 `reservationUtils` 모듈이 통째로 mock돼 `findOverlappingReservation`이 항상 `null`을 반환하는 탓에, 넣은 예약 픽스처가 **로직에 도달조차 하지 않았다**(빈 배열로 바꿔도 통과 = 기존 "단일 예약 1건 생성"과 동일한 중복 테스트). 해당 케이스만 `vi.importActual`로 실제 구현을 주입하고 `createReservationSafe` 호출 인자까지 단언, 같은 차량이면 차단되는 **대조군**을 추가했다. 뮤테이션 실측 — 제거한 차단 로직을 되살리면 해당 테스트가 실패한다(1 failed / 9 passed) |
| **배포 경로 — 예외 적용** | 사용자 요청으로 Hosting만 수동 선배포했다(CLAUDE.md 긴급 예외). 프론트엔드 전용 변경이라 Functions 동시 업데이트 충돌 위험이 없고, 진행 중인 CI Deploy가 없음을 확인 후 Node 22로 실행했다. **선배포는 master를 앞서게 만들므로**, 다음 CI 배포가 수정을 되돌리지 않도록 Phase 127과 한 PR로 묶어 master를 프로덕션과 한 번에 맞췄다 |
| **검증** | ESLint 0 · tsc 0 · 프론트 94파일/976건(reservationSubmitActions 8 → **10건**) · 프로덕션 빌드 통과(번들 예산 이내) |
| **안 한 것** | `findUserOverlappingReservation`([reservationUtils.ts](../../src/hooks/utils/reservationUtils.ts))은 이 변경으로 프로덕션 호출부가 0건이 됐지만(테스트 5건 + mock 1건만 참조) 스코프 밖이라 남겼다. Phase 126이 "고친 사본과 안 고친 사본을 함께 두면 재발한다"며 죽은 사본을 제거한 전례가 있어, **정리 대상으로 남는다** |
| **범위 밖 관찰 — 확인 필요** | 리뷰 중 발견. 다일·반복 예약 **그룹 수정** 경로가 호출하는 `deleteReservationGroup`/`deleteRecurringGroup`은 클라이언트 `batch.delete()`인데 `firestore.rules`의 reservations delete는 `isSuperAdmin()` 한정이다. 정적으로는 일반 직원·기관 관리자가 다일 예약을 수정 저장하면 `permission-denied`로 실패하고 원본 그룹이 남는다. Rules 테스트에 reservations delete 케이스가 없어 회귀로도 안 잡힌다 — 에뮬레이터 재현 확인이 남는다 → **Phase 129에서 재현·수정** |

---

### Phase 129: 다일·반복 예약 수정이 항상 실패하던 문제 — Rules delete 권한 불일치 🔐 (커밋·PR)

> Phase 128 리뷰가 "범위 밖 관찰"로 남긴 의심을 에뮬레이터로 재현했다. **의심이 아니라 살아 있는 버그였다.**

| 항목 | 내용 |
|------|------|
| **증상** | 다일 예약이나 반복 예약을 수정하면 무조건 실패한다. 사용자에게는 Firebase 원문 그대로 `Missing or insufficient permissions.` 영문 토스트가 뜨고([submitActions.ts](../../src/hooks/reservationCalendar/actions/submitActions.ts)의 `catch`가 `error.message`를 그대로 노출), 원본 그룹은 남는다 |
| **원인 — 클라이언트 경로와 Rules 권한이 어긋나 있었다** | 그룹 수정은 "기존 그룹 삭제 → 재생성" 구조라 **삭제 권한이 필요**한데, `firestore.rules`의 reservations `delete`는 `isSuperAdmin()` 한정이었다. 즉 superAdmin 외 **전원**(직원·기관 관리자) 실패 |
| **도달 경로 (전부 살아 있음)** | [ReservationCalendar.tsx:130](../../src/components/common/ReservationCalendar.tsx) `onEdit={handleEdit}` → [editActions.ts:61](../../src/hooks/reservationCalendar/actions/editActions.ts) `setEditingGroupId(res.groupId)` → [submitActions.ts:90](../../src/hooks/reservationCalendar/actions/submitActions.ts) `deleteReservationGroup()` → `batch.delete()` → Rules 차단 |
| **에뮬레이터 재현** | `PERMISSION_DENIED: false for 'delete' @ L192` — 소유자 본인조차 자기 예약을 지울 수 없었다 |
| **왜 신고가 없었나** | `allow delete: if isSuperAdmin()`은 Phase 30 무렵부터 있던 오래된 규칙이라 그룹 수정 기능은 사실상 도입 이후 계속 이 상태였을 가능성이 높다. 다일·반복 예약 **수정**(생성·취소가 아니라)이 드문 조작이라 묻혀 있었다 |
| **조치 — 소유자 본인으로만 한정 완화** | `allow delete`에 소유자 본인 분기만 추가. `update`가 이미 소유자에게 같은 범위를 허용하고 있어 새로 열리는 권한이 아니다(소유자는 어차피 자기 예약을 취소·수정할 수 있었다). 타 기관·같은 기관 타인 삭제는 계속 차단 |
| **기관 관리자를 뺀 이유 — 리뷰가 잡아낸 함정** | 처음에는 `update` 규칙과 같은 모양으로 기관 관리자까지 넣었는데, 적대적 리뷰가 **이 PR이 새로 만드는 데이터 오염**을 찾아냈다. [createReservationSafe](../../functions/src/handlers/callable/createReservationSafe.ts)는 `request.data`에서 `reservedByUid`를 **꺼내지 않고** [createReservationCore](../../functions/src/services/reservation/createReservationCore.ts)가 `reservedByUid: actorUid`로 호출자를 강제하는데, `reservedByName`은 클라이언트 값을 그대로 쓴다. [ReservationAccordion](../../src/components/common/ReservationAccordion.tsx)은 `isAdmin \|\| 본인`에게 수정 버튼을 노출한다. 즉 관리자가 직원 그룹을 수정하면 재생성분이 `reservedByUid = 관리자` · `reservedByName = 직원`이 되어 **직원이 자기 예약의 수정·취소·삭제 권한을 전부 잃고**(update·delete 둘 다 `reservedByUid` 기준), `getMyRecentReservations`에서도 빠지며, 본인에게 "본인이 예약했습니다" 푸시가 간다. 지금까진 삭제에서 막혀 아무 일도 안 일어났으므로, **관리자 분기를 넣는 순간 "실패"가 "조용한 오염"으로 바뀐다**. 관리자 경로는 서버에서 명의 지정을 먼저 고친 뒤 별도로 연다 |
| **양방향 뮤테이션 실측** | 규칙 하나에 허용·차단이 함께 걸려 있어 한 방향만 재면 반쪽이다. ① 원래대로 `isSuperAdmin()`만 → **허용 케이스 실패**(재현 그 자체) ② 반대로 `belongsToMyOrg()`만 → **차단 케이스 실패**(`Expected request to fail, but it succeeded`). 양쪽 다 잡히는 것을 확인하고 규칙을 확정했다 |
| **테스트** | Rules 테스트에 reservations `delete` 케이스가 **아예 없었다**(그래서 회귀로도 안 잡혔다). 5-2 신설 — 소유자 허용 · 같은 기관 타인 차단 · 타 기관 차단 · **기관 관리자의 타인 예약 차단**(명의 이전 방지 고정) 4방향. Firestore Rules 16 → **17건** |
| **안 한 것 ① 남는 비원자성** | 그룹 수정이 "삭제 → 재생성"인데 **트랜잭션이 아니다**. 삭제 후 재생성이 실패하면 예약이 통째로 사라진다. 지금까지는 삭제 단계에서 막혀 오히려 데이터가 보존되고 있었던 셈이라, 이 수정으로 **위험이 드러난다**. 게다가 클라이언트 사전 겹침 검사는 [submitActions](../../src/hooks/reservationCalendar/actions/submitActions.ts)에서 `date: selectedDate` 즉 **첫날만** 보므로, 종료일을 늘리다 2일차 이후가 서버에서 `already-exists`로 걸리면 원본은 이미 지워진 뒤다 |
| **안 한 것 ② `in_progress` 예약 하드 삭제** | [batchGroupAction](../../src/lib/firestore/reservations.ts)의 필터가 `cancelled`·`completed`만 제외해 `in_use`/`in_progress`도 삭제 대상이다. 3일 출장 1일차 운행 중에 그룹을 수정하면 해당 문서가 사라지고, 운행일지 저장 시 `updateReservationStatus`가 없는 문서에 걸려 `reservationId`가 끊긴 채 남는다 |
| **안 한 것 ③ 관리자 그룹 수정** | 위 "기관 관리자를 뺀 이유" 참고. 서버가 명의를 지정받도록 고친 뒤에 열어야 한다 |
| **근본 해결 방향** | ①~③ 모두 그룹 수정 전체를 콜러블(Admin SDK 트랜잭션 + 명의 지정 + 상태 검사)로 옮기면 한 번에 정리된다. 작업량이 커 별건으로 남긴다 |
| **검증** | Firestore Rules 17건 통과(에뮬레이터) · ESLint 0 · tsc 0 |
| **배포** | Rules는 CI Deploy가 `--only functions,firestore:rules,storage`로 배포하므로 머지만 하면 반영된다(수동 배포 불필요) |

---

### Phase 130: 수탁자 지위 명시 · 약관 위탁 조항 신설 · 재동의 게이트 🔐📜 (CI 배포 완료)

> 2026-08-01, Phase 121이 처리방침에 위탁 사실을 **고지**했다면 이 회차는 그 위탁에 **동의를 받고 기록**한다. 세 PR을 스택으로 쌓았다(#91 기관 → #92 직원 → #93 기존 사용자 재동의). 이 회차의 핵심은 조항을 늘린 것이 아니라 **누구에게 무엇을 받지 않을지**를 정한 것이다 — 직원에게 개인정보 동의를 받는 편이 서류상 안전해 보이지만, 그것이야말로 수탁자가 처리자처럼 행동한 증거가 된다.

| 항목 | 내용 |
|------|------|
| **지위 확정** | 소속 기관이 **개인정보처리자(위탁자)**, 서비스 제공자가 **수탁자**다. 처리방침(Phase 121)이 수탁자 목록을 공개하는 데 그쳤다면, 여기서는 약관 본문에 **제9조(개인정보 처리의 위탁)**를 신설해 위탁의 근거·범위·재위탁·수탁자 관리 책임을 계약 조항으로 만들었다. 시행일 `2026-08-05` |
| **버전 상수 단일 원본** | `TERMS_VERSION`·`PRIVACY_VERSION`(`src/lib/constants.ts`)을 시행일 문자열로 두고, 페이지 본문의 시행일 표기까지 이 값에서 **파생**시켰다. 본문만 고치고 동의 기록 버전을 안 올리는 어긋남이 구조적으로 생기지 않는다 |
| **#91 기관 동의 (신청 시점)** | `submitOrgApplication`이 `agreedTerms`·`agreedPrivacy`·두 버전을 받아 **서버에서 확정**하고 기관 문서에 `consent`로 저장한다. 프론트의 버튼 `disabled`는 콜러블 직접 호출을 막지 못하므로 여기서 막지 않으면 동의 기록 없는 기관이 생성된다. 동의 시점 IP는 수집하지 않는다 — 신청자 이메일·전화번호로 동의 주체가 특정되므로 최소수집 원칙이 앞선다 |
| **#92 직원 동의 — 개인정보 동의는 일부러 받지 않는다** | 직원 개인정보의 처리 근거는 동의가 아니라 **기관의 업무 수행**(보호법 제15조 ① 2·4호)이다. 동의를 근거로 삼으면 직원이 철회하는 순간 운행일지를 못 쓰게 되고, 수탁자 구조에서 정보주체 고지·동의 책임은 위탁자인 기관에 있으므로 **서비스가 직접 개인정보 동의를 받는 것 자체가 처리자처럼 행동한 증거**가 된다. 그래서 `joinOrganization`은 이용약관 동의(계정 개설·면책 근거)만 기록한다 |
| **버전값을 현행과 일치까지 강제하지 않은 이유** | 세 콜러블 모두 `/^\d{4}-\d{2}-\d{2}$/` 형식만 검증한다. PWA라 서비스워커가 이전 번들을 캐시하고 있을 수 있어, 캐시된 화면에서 신청하면 직전 버전을 보낸다. 서버가 이를 거부하면 **정상 신청자가 가입 자체를 못 하게 되고**, 이 손실이 임의 날짜가 기록되는 것보다 크다. 기관명·연락처 등 다른 필드도 모두 신청자 제출값이고 superAdmin 심사를 거치므로 버전값만 신뢰 수준을 높게 잡을 실익도 없다 |
| **동의 기록은 클라이언트가 못 건드린다** | Rules에서 `consent`를 **필드 단위로 봉인**했다. users: `create`의 `hasAny` 금지 목록에 `consent` 추가 + `update`는 `diff().affectedKeys().hasAny(['consent'])`면 **본인·기관관리자·superAdmin 전원 거부**. organizations: 같은 update 차단에 더해 **`create`에서도 `consent`를 심을 수 없게** 했다 — 막지 않으면 superAdmin이 클라이언트에서 임의 동의 기록을 가진 기관을 만들 수 있어 update 차단이 무의미해진다. 기록 경로는 Admin SDK 콜러블 3종뿐 |
| **#93 기존 사용자 — 역할별로 다른 강도** | 시행일 이전 가입자에는 동의 기록이 없다. **기관 관리자는 차단 모달**(위탁 계약 당사자가 기관이고 그 의사표시를 관리자가 하므로, 동의 없이 기관 데이터를 계속 처리할 근거가 없다), **직원은 비차단 배너**(계정 개설·면책 근거일 뿐 업무를 막을 사유가 아니다). 관리자 1회 동의로 기관 `consent`와 본인 `consent`가 **batch로 원자적** 기록된다 — 순차 쓰기면 기관 쓰기 실패 시 "본인 동의만 있는 관리자"라는 어정쩡한 상태가 남는다. 재동의분은 `source: 'reconsent'`·`agreedByUid`로 신청 경로와 구분한다 |
| **게이트를 띄우지 *않는* 조건이 설계의 절반** | ① `userDocState !== 'present'`면 판정 보류(깜빡임·오판 방지) ② `organizationId`가 없으면 제외 — 초대 코드 입력·승인 대기 중은 가입 플로우가 이미 동의를 받고, superAdmin은 자연히 빠진다 ③ **기관 문서 읽기 실패 시 게이트를 띄우지 않는다** — 읽기 실패로 관리자를 차단하면 복구 수단 없이 앱을 못 쓰게 된다. 가용성이 기록 완결성보다 앞서는 지점 |
| **restoreUser 동의 승계 (리뷰 발견)** | `restoreUser`의 사용자 문서 재생성은 `merge` 없는 `set`이라 기존 필드가 사라진다. 그런데 `consent`는 **재수집 경로가 없다** — `joinOrganization`은 미가입자 전용이라 복원된 직원은 다시 동의할 방법이 없고, Rules가 클라이언트 쓰기를 막아 손으로도 못 채운다. 복원 전 문서를 읽어 `consent`만 명시적으로 이어받는다 |
| **CI가 처음 돌면서 드러난 결함 2건** | 스택 재정렬(`rebase --onto`) 후 #93에 CI가 처음 붙자 두 가지가 터졌다. ① `acceptCurrentTerms`가 **함수 카탈로그 미등록**이라 하네스 Doctor가 차단(CLAUDE.md 절대 규칙 #3의 문서판) ② 인증 E2E 시드에 동의 기록이 없어 **게이트 모달이 클릭을 가로채 6건 실패** — 게이트가 실제로 동작한다는 역설적 증거였다. 시드에 `consent`를 추가해 해소 |
| **스택 운영** | #91 squash 머지로 #92·#93의 base가 어긋날 때마다 `rebase --onto`로 master 위에 재정렬했다. 충돌은 `tests/firestore-rules.test.ts`(동의 기록 ↔ 접속기록 테스트)·`docs/FUNCTIONS_REFERENCE.md` 모두 **순수 추가 충돌**이라 양쪽 유지. CI가 스택 PR의 base 변경을 감지하도록 워크플로 트리거에 `edited` 타입을 추가(#113) |
| **테스트** | Functions — `acceptCurrentTerms` 11 · `joinOrganization` +6 · `submitOrgApplication` +7. 프론트 — `useConsentGate` 12 · `InviteCodePage` 7 · `useOrgApplication` 18 · `legalVersions` 1. Firestore Rules 17 → **19건**(consent 봉인 양방향). 프론트 전체 991건 · E2E `terms-privacy.spec.ts` 보강 |
| **검증·배포** | 세 PR 모두 CI·functions-tests·Preview·CodeQL·Greptile 통과 후 squash 머지, Deploy 완료. Rules는 CI Deploy가 함께 배포한다 |
| **업데이트 소식 반영** | 7월 19일 이후 배포분이 `public/data/releaseNotes.json`에 2주간 반영되지 않아 **관리자에게 갑자기 동의 모달이 뜨는 이유를 설명할 문서가 없었다**. Phase 112·120~130 기준으로 7건을 소급 작성(약관 개정·재동의 / 다일·반복 예약 수정 / 다중 차량·구글 계정 전환 / 접속기록·km 동기화 / 처리방침 위탁 고지 / 하이패스 PDF 표기 / 예약 10분 전 Slack DM). 같은 파일에서 2026-02-27 항목 1건이 날짜 역순으로 놓여 있던 것도 위치만 바로잡았다(날짜·본문 불변) |
| **남은 것** | ① 관리자 재동의 전환율 — 차단 모달이라 미동의 기관은 앱을 못 쓰므로 며칠 내 실제 동의율 확인 필요 ② 시행일(2026-08-05) 도래 전 기존 기관 대상 사전 공지 ③ Phase 123이 남긴 접속기록 Phase 2(행위자 스탬프·세션 IP·반출 기록) — 이 회차가 우선순위 조건으로 걸어둔 "#91~#93 머지"가 충족됐다 |


---

### Phase 131: 문서에만 남아 있던 결함 정리 — 예약 화면 무한 스피너 · 죽은 코드 🔧🧹 (커밋·PR)

> 2026-08-01, Phase 122·128이 "부수 발견"·"정리 대상"으로 적어만 두고 지나간 두 건을 처리했다. 둘의 성격이 다르다 — ①은 **실사용자가 지금 겪을 수 있는 결함**이 조사 기록 안에 묻혀 있던 것이고, ②는 고쳐진 사본과 안 고쳐진 사본이 함께 남아 재발을 기다리던 것이다. 문서에 적어 둔 것과 고친 것은 다르다는 점이 이 회차의 요지다.

| 항목 | 내용 |
|------|------|
| **① 무한 스피너 — 경로** | [useReservationData.ts](../../src/hooks/reservationCalendar/useReservationData.ts)의 `Promise.all`이 `getHolidays()`를 await → `fetchPublicHolidays`가 `system/holidays` 미스 시 외부 공공데이터 API로 폴백 → **그 fetch에 타임아웃이 없어 무기한 대기** → `loading`이 `finally`에서만 풀려 미해제 → `ReservationCalendar`가 스피너만 반환. Phase 122가 E2E 조사 중 발견해 "이 PR 범위 밖"으로 남긴 그대로였다 |
| **왜 두 층에서 끊었나** | 타임아웃만 두면 5초는 여전히 화면이 멈추고, 비차단만 하면 외부 API가 응답하지 않는 동안 연결이 물린다. 폴백 fetch에 `AbortController` 5초 상한을 두고(useSettings의 공휴일 조회에도 함께 적용된다), 동시에 공휴일을 `Promise.all`에서 빼내 비차단으로 돌렸다 |
| **실패해도 토스트를 띄우지 않는다** | 공휴일은 달력의 부가 표시일 뿐이고 사용자가 할 수 있는 일이 없다. "데이터를 불러오는데 실패했습니다"를 띄우면 예약은 정상인데 문제가 있는 것처럼 보인다. 차량 조회 실패는 기존대로 토스트를 띄우며, 이 대조군을 테스트로 고정했다 |
| **뮤테이션 실측** | 공휴일을 다시 `Promise.all`로 되돌리니 신설 테스트 4건 중 3건 실패(무한 대기·실패 처리·늦은 도착), 원복 후 4/4 통과. 대조군 1건은 양쪽에서 통과 — 즉 이 테스트들이 재는 것이 정확히 비차단 여부다 |
| **② 죽은 코드** | `findUserOverlappingReservation` — Phase 128이 사용자 단위 겹침 차단을 걷어내며 프로덕션 호출부가 0건이 됐는데(테스트 5건 + mock 1건만 참조) 스코프 밖이라 남겨 뒀던 것. 사용자 단위 겹침 정책은 서버 코어·FAQ 어디에도 없으므로 되살아날 근거가 없다. Phase 126이 "고친 사본과 안 고친 사본을 함께 두면 나중에 누가 후자를 부른다"며 같은 정리를 한 전례를 따랐다 |
| **검증** | 프론트 테스트 7건 신설(`useReservationData` 4 · `holidayApi` 3), 전체 통과. ESLint 0 · tsc 0 |
| **남은 것** | `system/holidays`를 채우는 `monthlyBatch`가 실패한 연도에는 공휴일 표시가 비게 된다. 화면은 더 이상 막히지 않으므로 긴급도는 낮지만, 배치 실패 알림과 함께 별건으로 볼 값이 있다 |

---

### Phase 132: 접속기록 Phase 2 — 행위자 스탬프 · 세션 IP · 반출 기록 🔐📋 (커밋·PR)

> 2026-08-01, Phase 123이 "#91~#93 머지 이후"를 조건으로 걸어 둔 후속이며, 그 조건은 Phase 130으로 충족됐다. 고시 제16조가 요구하는 다섯 항목(계정·일시·접속지·정보주체·수행업무) 중 Phase 1이 채운 것은 셋뿐이었다. 이 회차의 핵심은 세 항목을 채운 것이 아니라, **각 기록이 우회 가능한지를 구분해 적었다**는 점이다 — 전부 "기록된다"고 뭉뚱그리면 점검자가 없는 것을 있다고 믿게 된다.

| 항목 | 내용 |
|------|------|
| **① 행위자 스탬프 — 위조 불가의 근거** | 클라이언트가 `lastEditedByUid`를 심고 Rules의 `actorStampValid()`가 `request.auth.uid`와의 일치를 강제한다. 심는 주체는 클라이언트지만 **타인 명의로는 심을 수 없다**. 덕분에 모든 쓰기를 콜러블로 옮기거나 오프라인 큐 구조를 바꾸지 않고 행위자가 확정된다. 적용 7곳: `updateDriveLog`·`adjustAdjacentLogs` 2곳·`updateUser`·`restoreUser`·`clearUserOrganization`·`addSuperAdmin`·`removeSuperAdmin` |
| **①-1 "변경될 때만" 검사한 이유 — 뮤테이션이 실증했다** | 모든 update에 스탬프를 요구하는 엄격 형태로 조여 보니 **기존 Rules 테스트 3건이 깨졌다**(관리자 organizationId 차단 · consent 주입 차단 · 대표 운전자 수정). 엄격 형태였다면 스탬프를 심지 않는 경로가 통째로 `permission-denied`가 됐을 것이다 — Phase 129에서 Rules가 클라이언트 경로보다 좁아 다일·반복 예약 수정이 전부 실패했던 것과 같은 함정이다. 생략은 여전히 가능하지만 그 경우 `actorSource: 'unknown'`으로 남아 **누락이 성공으로 위장되지 않는다** |
| **①-2 삭제에는 쓰지 않는다** | 삭제된 문서에 남은 스탬프는 마지막 '수정자'이지 '삭제자'가 아니다. 삭제자로 확언하면 무고한 사용자에게 책임이 귀속되며 `unknown`보다 나쁘다 — Phase 123의 `restoreUser` 행위자 오기재와 같은 판단이다. 테스트로 고정했다 |
| **② 세션 기록 — 트리거가 볼 수 없는 것** | 접속지(IP)는 Firestore 트리거가 볼 수 없어 Phase 1에서 전무했다. `recordSession` 콜러블이 `rawRequest`에서 IP·UA를 직접 읽는다. 문서 ID를 세션 식별자(sessionStorage 난수)로 고정해 탭 복원·리렌더의 재호출이 중복을 만들지 않고, 탭을 닫으면 다음 접속이 새 기록이 되어 접속 단위와 맞는다 |
| **②-1 최소수집 — UA를 축약한다** | User-Agent 원문은 기기 모델(`SM-S911N`)·상세 버전을 담아 기기 지문에 가까워진다. `"Chrome / Android"` 수준으로 축약해 저장하고, 원문·모델·버전이 새어 들어가지 않는 것을 테스트로 고정했다. Edge·삼성인터넷이 UA에 Chrome을 포함하므로 **좁은 것부터** 판정한다(오분류 시 접속 환경 통계가 통째로 틀어진다) |
| **②-2 블로킹 함수를 쓰지 않은 이유** | 우회 불가능한 대안은 Auth 블로킹 함수(`beforeUserSignedIn`)다. 인증 서버가 직접 호출하므로 클라이언트가 건너뛸 수 없다. 채택하지 않은 근거 둘 — ① Identity Platform 업그레이드로 **요금 체계가 바뀐다**(무료 운영이 전제인 서비스에서 함부로 정할 수 없다) ② 함수 실패가 **로그인 자체를 막는다**. 감사 기록의 실패가 전체 가용성을 끊는 교환은 나쁘다. 코드 주석에 근거와 함께 남겼다 |
| **③ 반출 기록 — 열람이 아니라 반출** | Phase 123은 전면 열람 로그를 하지 않기로 했다(로그가 원본보다 커지고 실질 위험은 반출에 있다). `recordExport` 콜러블 + 클라이언트 헬퍼로 엑셀 4종·PDF 5종 전 경로를 배선했다. `pdfEngine`이 `auditDataset`을 **필수 필드**로 요구하므로 새 리포트가 기록을 빠뜨리면 타입 검사에서 걸린다 |
| **③-1 남기지 않는 것** | 형식·대상·건수만 남긴다. 반출 데이터 내용은 물론 **검색 조건도 남기지 않는다** — 목적지·이름이 검색어에 들어갈 수 있다. `dataset`은 화이트리스트라 임의 값 주입으로 로그를 오염시킬 수 없다(Phase 123이 블랙리스트를 뒤집으며 막은 경로와 같다). 정보주체 목록도 비운다 — 수백 건 반출에 억지로 채우면 로그가 uid 명단이 된다 |
| **③-2 우회 가능성을 구분해 적었다** | 엑셀·PDF는 브라우저에서 만들어지므로 **클라이언트가 부르지 않으면 남지 않는다**. 서버 생성으로 바꾸면 5,000건을 Functions 메모리에 올려야 해 비용·타임아웃 위험이 크다. 반면 `getOrgDocumentUrl`(superAdmin의 타 기관 증빙서류 열람)은 서버 콜러블이라 **우회 불가하게 기록된다**. 이 차이를 각 파일 주석에 명시했다 |
| **③-3 범위 조정 — 직원 목록 일괄 조회** | Phase 123 계획에 있었으나 이 코드베이스에 직원 목록 **내보내기가 존재하지 않는다**. 남은 것은 화면에 목록을 띄우는 조회뿐인데(운전자 선택 등) 이는 반출이 아니고, 기록하면 예약 화면을 열 때마다 로그가 쌓여 점검을 방해한다. 넣지 않고 근거를 남겼다 |
| **공통 모듈** | `services/audit/writeAuditEntry.ts` 신설 — 컬렉션·보관기간(1년)·`__system__` 기관·필드 이름을 트리거 쪽과 일부러 맞춘다. 어긋나면 Phase 3의 점검 화면이 두 벌의 해석 코드를 갖게 된다. `undefined` 필드는 넣지 않는다 — 없는 항목이 `null`로 남으면 "확인했는데 없음"과 "해당 없음"이 구분되지 않는다 |
| **처리방침 — 수집 전에 고지** | IP는 새로 수집하는 개인정보이므로 제1조에 '접속기록' 항목을 신설했다. 법령상 의무 기록이라 동의를 근거로 하지 않으며 거부할 수 없다는 점, 1년 후 자동 파기, 변경 항목은 이름만 남기고 값은 남기지 않는다는 점을 함께 적었다. 제2조 이용 목적·개정 이력도 갱신 |
| **⚠️ PRIVACY_VERSION을 올리지 않았다 — 확인 필요** | 시행일(2026-08-05)이 아직 오지 않아 **시행 전 보완**으로 보고 버전을 유지했다. 올리면 Phase 130에서 어제 동의한 관리자에게 며칠 만에 두 번째 차단 모달이 뜬다. 다만 8/1~8/4에 동의한 기관은 접속기록 항목이 추가되기 **전** 문안에 동의한 것이 되므로, 엄격히 보려면 버전을 올려 재동의를 받는 선택지가 있다. 운영자 판단 필요 |
| **검증** | Firestore Rules 19 → **20건**(스탬프 위조 차단·생략 허용·관리자 책임 전가 차단 5방향) · Functions 단위 **647건**(`recordSession` 22 · `recordExport` 16 · `auditLog` 30 → 36) · 프론트 **1021건**(`actorStamp` 4 · `useSessionRecord` 7 · 클라이언트 `recordExport` 5) · 함수 카탈로그 등록 + FUNCTIONS_REFERENCE 재생성(66개) · 하네스 Doctor 13영역 0건 |
| **남은 것** | ① **삭제 행위자** — 스탬프를 쓸 수 없어 여전히 공백이다. 세션 기록과 시각을 대조해 좁히거나 삭제를 콜러블로 옮겨야 한다 ② 엑셀·PDF 반출의 우회 가능성(위 ③-2) ③ Phase 3 점검 화면 — 이제 기록 종류가 넷(변경·로그인·반출·타 기관 열람)이라 조회 필터 설계가 필요하다 ④ `auditLogs` 복합 인덱스는 Phase 3에서 쿼리 형태가 정해질 때 추가 |

