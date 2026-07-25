# 트랙 B — 운영 고도화 로그 (Phase 82~102)

> 2026-07-04 ~ 2026-07-19. 멀티테넌트 격리 환류·Slack 어시스턴트·App Check 1~2차 강제 구간.
>
> 전체 목차와 다른 구간은 [구현이력.md](../구현이력.md) 참고.

---

### Phase 82: `/cso` 보안 감사 환류 — 멀티테넌트 쓰기 격리 8건 수정 🛡️ (코드 완료·배포 대기)

> 2026-07-04, `/cso` 공격자 관점 감사(리포트 `docs/security-reports/2026-07-04.md`). 직전 리포트(6/26)의 확정 발견 3건이 모두 수정됐음을 확인하고, 신규 확정 8건을 탐지→전건 수정했다. 지배적 주제는 **읽기 격리는 견고하나, 규칙·트리거·콜러블이 문서가 지정한 식별자(`organizationId`·`vehicleId`·`userId`)를 org 검증 없이 신뢰**하던 멀티테넌트 쓰기 격리의 구조적 구멍. Admin SDK(트리거·콜러블)는 Rules를 우회하므로 각 핸들러가 유일한 가드인데 그것이 빠져 있었다.

| 항목 | 내용 |
|------|------|
| **N1 (HIGH) 교차 테넌트 관리자 권한상승** | `firestore.rules` users update의 orgAdmin 분기가 `organizationId` 변경을 막지 않아, admin이 자기 문서의 org를 타 기관으로 바꾸면 `setCustomClaims`가 그대로 타 기관 admin 클레임을 부여 → 피해 기관 전체를 admin으로 장악. 기관 ID는 `joinOrganization` 반환값으로 노출. **수정**: 분기에 `request.resource.data.organizationId == resource.data.organizationId`(org 불변) 강제. 규칙 테스트 8번(admin org 변경 → assertFails, org 불변 role 변경 → assertSucceeds), 에뮬레이터 8/8 |
| **N2 (MED-HIGH) 예약 트리거 알림 스푸핑** | 예약 create 규칙이 `reservedByUid`만 고정하고 `userId`는 미제약 → 트리거가 미검증 `after.userId`로 인앱 알림+FCM 푸시를 타 기관 임의 사용자에게 주입(2026-07-03 알림 규칙 잠금을 트리거 경로로 재개방). **수정**: 6개 알림 경로를 `isNotifiableOrgMember(uid, org)` 게이트 — 대상이 예약 org 소속일 때만 발송 |
| **N3 (MED) `vehicleId` 소속 미검증 클러스터** | driveLogs/reservations 규칙이 org만 고정하고 vehicleId 소속 미검증 → Admin SDK 트리거·콜러블이 타 기관 차량 문서에 쓰기. **수정**: `createReservationSafe`(트랜잭션 내 차량 org 대조), `syncDriveLogKm`(currentKm 갱신 전 org 대조), `getVehicleCalendar`(expectedOrgId 불일치 시 null로 캘린더 주입 차단) |
| **N4 (MED) 공개 엔드포인트 레이트리밋 우회** | `submitOrgApplication`·`submitPublicFeedback`의 레이트리밋 키가 공격자 통제 이메일 → 회전으로 무제한 익명 쓰기+관리자 알림 증폭. **수정**: `checkRateLimitByIp`(10회/시) + 입력 길이 상한 추가(App Check는 프로젝트에서 제거됨 → IP+길이가 현실적 최선, IP 회전은 잔여 리스크) |
| **N5 (MED) 관리자 이메일 HTML 인젝션** | `notifyNewApplication`이 기관명·신청자 등을 이스케이프 없이 관리자 이메일 HTML에 보간 → N4 연쇄 시 슈퍼관리자 표적 피싱. **수정**: 공용 `escapeHtml` 헬퍼 신설 후 4개 필드 이스케이프 |
| **N6 (MED) Gemini 비용 증폭** | `generateFeedbackDraft`가 문서의 `imageUrls`를 개수·크기 제한 없이 전량 fetch→1콜 투입(트리거라 레이트리밋도 없음). **수정**: 공용 `fetchPromptImages`(개수 3·개당 5MB 상한)로 두 핸들러 일원화 |
| **N7 (MED) LLM 하드닝 쌍둥이 갭** | `regenerateFeedbackDraft`가 Phase 74에서 트리거판에만 적용된 `sanitizePromptValue`+가드 문구 미적용. **수정**: 콜러블 쌍둥이에 동등 적용 |
| **N8 (LOW) 서비스계정 키 커밋 갭** | 스크립트/스킬이 참조하는 `serviceAccountKey.json`·`service-account.json`이 `.gitignore` 미포함(현재 유출 없음, 예방형). **수정**: `.gitignore`에 3개 패턴 추가 |
| **검증** | functions `type-check` 클린, 전체 단위 테스트 228/228 통과(신규 교차 테넌트 회귀 3건 포함), Rules 테스트 8/8 통과. 억제 8건(설계상 공개 값·오라클·문서 드리프트 등)은 리포트 부록에 기재 |
| **배포 유의** | `firestore.rules`+Functions 변경이라 master 푸시 시 CI(Deploy 워크플로)가 배포한다. 로컬 `firebase deploy` 미수행. 규칙 변경은 즉시 전 사용자 적용되므로 배포 후 `permission-denied` 급증 관찰 권장 |

### Phase 83: 차량별 사용 가능 직원 제한 — 지정 차량 예약·운행 차단 🔒 (코드 완료·배포 대기)

> 2026-07-04, 기관 실사용 피드백 대응. "특정인들만 사용하는 차량인데 운행일지 통일을 위해 모두 등록해놓으니 다른 직원이 예약해버리고, 관리자가 많아 상황을 모르고 승인한다"는 의견을 받아, 관리자가 차량별로 **사용 가능 직원**을 지정할 수 있게 했다. 지정하지 않으면 전체 허용이라 기존 차량은 무변화(마이그레이션 불필요).

| 항목 | 내용 |
|------|------|
| **데이터 모델** | `Vehicle.allowedUserIds?: string[]` 추가(undefined/빈 배열 = 전체 허용). `vehicleSchema`(Zod)에 동시 추가 — `createZodConverter` 경유 읽기라 스키마 누락 시 필드가 조용히 소실되는 함정 회피 |
| **판정 단일화** | `vehicleUtils.isVehicleRestrictedForUser(vehicle, uid)` 공용 헬퍼 — 목록 없음/빈 배열·목록 포함이면 false. **역할 예외 없음**(당초 admin 예외로 설계했으나 사용자 결정으로 제거 — 관리자도 목록에 없으면 불가, 필요 시 폼에서 자신을 추가). UI 4곳·제출 검증이 모두 이 헬퍼 하나로 판정 |
| **관리자 UI** | 차량 등록/수정 폼(보험↔캘린더 사이)에 "🔒 사용 가능 직원 (선택)" 칩 토글(활성 멤버만 렌더, superAdmin·비활성 제외). 차량 카드에 "🔒 지정 N명" 배지. 전부 해제 시 `[]` 저장으로 제한 해제되도록 vehicleData에 항상 포함(조건부 스프레드 금지) |
| **직원 UI** | 두 VehicleSelector(공용 예약·employee 운행일지/빠른운행)에서 제한 차량을 숨기지 않고 🔒 "지정 차량" 배지 + disabled(정비 중 패턴 확장). 컴포넌트 내부 `useAuth()`로 uid 취득해 prop drilling 회피 |
| **서버 강제** | `createReservationSafe` 트랜잭션 내 기존 차량 org 검증(N3) 직후 허용 목록 검사 — 이미 읽는 vehicleSnap 재사용이라 추가 read 0. caller uid 기준(서버가 `reservedByUid=auth.uid` 강제 저장이라 검사·저장 일치), 역할 무관 목록 기준. 위반 시 `permission-denied` |
| **제출 방어** | 예약 submitActions·빠른운행 handleStart에 방어 체크(disabled UI를 뚫는 상태 버그 대비), 빠른운행 자동 선택(`availableVehicles`)이 제한 차량을 집지 않도록 필터. `createReservationSafe` 클라 래퍼 Sentry 제외에 `permission-denied` 추가(기대되는 비즈니스 에러 노이즈 방지) |
| **범위 제외(의도)** | Firestore Rules 미변경(no-get() 설계 유지 — 직접 SDK 쓰기 우회는 내부 도구 위협 모델에서 수용), 운행일지 제출 서버 강제 없음(실제 운전 기록은 남길 수 있어야 함), 캘린더 역동기화 예약 미적용(캘린더 접근 권한자 신뢰) |
| **UI 다듬기(로컬 확인 후속)** | ① 차량 선택 그리드에서 잠금 차량을 맨 뒤로 정렬(사용 빈도순 유지) ② 차량 폼의 보험·사용 가능 직원·캘린더 섹션을 접기/펼치기 전환(접힌 헤더에 입력 요약 표시, 캘린더 오류 진입 시 자동 펼침) ③ 시간대 현황(VehicleTimelineRow)은 잠금 차량 행을 그대로 보여주되 드래그 예약 시작 차단 + 차량명 🔒 표시 — 숨기지 않기로 결정(선택기와 일관성·가동 현황 정보 가치, 제출·서버 차단은 기존 방어로 커버) |
| **검증** | 프론트 lint·tsc·build(번들 예산 이내)·Vitest 전체, functions tsc·Jest 전체(신규 allowedUserIds 4케이스: 미포함 거부·포함 허용·admin도 거부·빈 배열 전체 허용). vehicleUtils 헬퍼 테스트 추가. 로컬 dev에서 직원 계정 잠금 표시 실사용 확인 |

### Phase 84: 대시보드 주유·하이패스·알림 통계 서버 캐시 이관 💰 (열람당 읽기 ~1.5만→~6, 코드 완료·배포 대기)

> 2026-07-04, Firestore 일일 읽기 4만→9만 증가 원인 분석에서 출발. superAdmin 운영 대시보드가 **열람할 때마다** fuelLogs·hipassCharges·notifications 30일 원본을 라이브 스캔(각 최대 5,000건 = 열람당 최대 ~1.5만 읽기)하는 것이 주범이었다. 운행일지 계열은 이미 `computeAllDashboardStats` 캐시(35,000→3 reads)로 이관됐으나 이 세 지표만 파이프라인에서 빠져 있었고, 사용자는 비용 때문에 "수시 확인" 습관을 포기하고 수동 갱신 버튼으로 강등한 상태였다.

| 항목 | 내용 |
|------|------|
| **서버 사전집계** | `dashboardSections.ts`에 순수 섹션 함수 2개 신설(`computeFuelHipassDaily`·`computeNotificationStats`, 기존 `computeReservationStats` 패턴). `computeAllDashboardStats`가 30일 원본 3종 getDocs + 집계쿼리 8종(admin SDK `AggregateField.count/sum`)을 병렬 조회해 **ALL 스코프 캐시 문서에만** 병합 저장(`system/dashboardStats`←fuelStats·hipassStats·notifSummary, `system/dashboardTimeSeries`←dailyFuelCost·dailyHipassAmount·dailyNotifStats·notifTypeCounts). 기관별 변형 문서는 무변경 — 기관 필터는 테넌트 스코프 쿼리라 원래 저렴해 라이브 유지(하이브리드 경계) |
| **KST 스큐 수정 (잠복 버그)** | 기존 날짜 키 앵커가 `new Date(Date.now()-29d)`의 로컬(=UTC) 날짜 파트여서 02:00 KST(=전일 17:00 UTC) 실행 시 일별 차트가 하루 밀리는 잠복 버그 — 주간 수동 갱신만 있어 미발현. `thirtyDaysAgoStr`(KST) 파생 앵커 + KST 자정 인스턴트로 교체해 야간 배치 도입 전에 선제 차단 |
| **야간 자동 재집계** | `dailyNightlyBatch`(매일 02:00 KST)에 Step 0.5로 `computeAllDashboardStats()` 추가(독립 try/catch) — 매일 아침 버튼 없이 최신 통계. 비용 야간 1회 ~1-2만 읽기(월 300~600원 수준, 사용자 승인) |
| **클라이언트** | `useServiceDashboard.loadAllStats` 재구성 — ALL 스코프에서 캐시에 새 필드가 있으면 직결 매핑, 없거나(첫 재집계 전) 기관 필터면 기존 라이브 로더 폴백(영구 안전망 존치). 알림 타입 라벨/색상 매핑을 `dashboardUtils.mapNotifTypeCounts`로 단일화(라이브 로더의 중복 상수 제거) |
| **검증** | 섹션 jest 11건 + `mapNotifTypeCounts` vitest 4건 + **에뮬레이터 통합 1건**(`computeDashboardStats.emulator.test.ts` — 실제 에뮬레이터에서 재집계 실행, 집계쿼리·KST 'M/D' 버킷·기관별 문서 미오염 검증, 기존 `*.emulator.test.ts` 패턴). 로컬 dev 서버에서 폴백 경로 육안 확인(운행 분석·사용자 경험 탭 정상 표시). tsc·lint·빌드 예산 이내 |
| **효과·후속 확인** | 대시보드 열람 비용 ~1.5만→4~6 읽기(수시 확인 복원, 열람 비용이 데이터 성장과 무관해짐). 배포 후: "전체 통계 갱신" 1회 → 캐시 경로 전환 확인, 다음날 야간 배치 후 일별 차트 날짜 밀림 없는지, 며칠 뒤 Firebase Console 일일 읽기 감소 추세 확인. 별건 기록: 알림 타입 라벨 맵에 `reservation_approved`·`feedback_reply` 등 누락(원시 키 노출, 기존 이슈 — 스코프 외) |

### Phase 85: 카드 액션 아이콘 모바일 상시 노출 — hover 전용 버튼 터치 접근성 📱 (코드 완료·배포 대기)

> 2026-07-04, 실사용 피드백. 차량 관리 카드의 수정·삭제 아이콘이 `opacity-0 group-hover:opacity-100`이라 마우스 hover가 없는 휴대폰·태블릿에서는 버튼에 접근할 수 없던 문제. 앱 전역에서 동일 패턴을 전수 조사해 실제 액션 버튼만 교정.

| 항목 | 내용 |
|------|------|
| **패턴 교체** | `opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100` — 터치 기기(마우스 없음)는 상시 표시, `pointer: fine`(마우스) 기기는 기존처럼 hover 시 노출. Tailwind v4 내장 `pointer-fine` 변형 신규 도입(별도 설정 불요) |
| **적용 4곳** | VehicleManager(수정·폐차·삭제·복원), HipassManager(수정·삭제), HolidayManager(사용자 지정 휴일 삭제), FeedbackForm(첨부 이미지 삭제 X). 버튼은 이미 `min-h/w-[48px]` 터치 타깃 확보 상태라 표시만 교정 |
| **의도 제외** | AnalyticsDashboard "클릭하여 보기 →"는 액션이 아닌 힌트 텍스트(카드 자체가 탭 가능해 모바일 기능 정상) — 상시 노출 시 카드마다 문구가 붙어 오히려 지저분해지므로 hover 유지 |
| **검증** | tsc·lint 통과(변경 파일 4종). 순수 className 변경, 릴리스 노트 1건 추가 |

### Phase 86: 로그인 차단 회복 함정 3건 수정 — 비활성 계정 재가입 우회·초대링크 막다른 화면·비활성 화면 org 초기화 🔒 (코드 완료·배포 대기)

> 2026-07-06, 기관 실사용 장애 제보. "차량 운행이 잦은 기존 직원이 갑자기 로그인 불가 → 관리자가 계정을 비활성했다가 다시 활성으로 돌려 복구 시도했으나 실패"와 함께 두 화면 스크린샷(① 초대코드 입력 + "이미 기관에 소속되어 있습니다" ② "계정이 비활성화되었습니다"). 코드 추적 결과 소프트삭제(`status:'disabled'`) 회복 경로에 서로 얽힌 함정 3건을 확인하고 근본 수정.

| 항목 | 내용 |
|------|------|
| **근본 진단** | ①번 화면은 별개 버그가 아니라 **이미 가입된 멤버가 초대 링크(`?code=`)로 `/invite`에 유입**된 결과였다 — `/invite`는 `requireAuth`만 걸려(no `requireOrgSetup`) 비활성만 아니면 초대 폼을 그대로 노출, 제출하면 `joinOrganization`이 "이미 소속"으로 막아 막다른 길. 진짜 원인은 ②번(`status:'disabled'` 지속)이며, 관리자 "활성화"(클라 `restoreUser`=Firestore `status:'active'`)가 안 먹히는 케이스가 얽혀 회복이 반쪽이 되는 구조 |
| **수정1 — 서버 가드** | `joinOrganization`에 기존 문서 `status==='disabled'`면 `permission-denied`로 재가입 차단. 비활성 사용자가 스스로 `organizationId`를 비운 뒤(아래 함정) 재가입해 `.set()`으로 문서를 덮어써 **비활성 상태 자체를 무력화하는 우회**를 봉쇄(동시에 스트랜딩도 예방). 정상 기관이동(status는 'active')은 영향 없음 |
| **수정2 — 비활성 화면 함정 제거** | `BlockedScreen`에 `allowTransfer` 프롭 추가. **기관 삭제됨** 화면에만 "다른 기관으로 가입"(스스로 org 초기화) 노출, **계정 비활성화** 화면에서는 제거하고 로그아웃만 남김. 비활성 사용자가 org를 비워 관리자 목록에서 사라지고(→ orgAdmin이 `isOrgAdmin(resource.data.organizationId)` 실패로 재활성화 불가) superAdmin만 복구 가능해지는 함정 차단. 화면 안내 문구("관리자가 다시 활성화하면 이용")와도 일관 |
| **수정3 — 초대링크 막다른 화면 제거** | `InviteCodePage`에서 `userData.organizationId` 보유 시 자동가입을 건너뛰고 `<Navigate to="/">`로 대시보드 재분배(게스트 라우트가 역할별 이동). 새 비활성 에러 문구 매핑 추가("비활성화된 계정입니다. 기관 관리자에게 문의해 주세요.") |
| **운영 도구** | `scripts/diagnose-user.ts` 신설 — 이메일로 Auth(`disabled`·customClaims)·`users` 문서(`status`·`organizationId`·`role`)·기관 상태·Claims 정합성을 한 번에 대조. 기본 읽기전용, `--fix`(Auth 재활성화+`status:active`+Claims 재설정+토큰 무효화)는 명시 플래그로 게이트, `organizationId` 공백이면 자동중단(superAdmin "계정 복원" 안내) |
| **검증** | 루트 tsc·functions tsc·ESLint 통과, 프로덕션 빌드 번들 예산 이내. AuthGuard 단위 5/5, functions 단위 222/222(disableUser·restoreUser 포함, 격리 재실행 확인), `joinOrganization.emulator` 6/6(신규 "비활성 계정 org 비워도 재가입 차단→permission-denied" 케이스 포함). 무관한 기존 실패: `tmapProxy.emulator`(외부 Tmap API) |

### Phase 87: firestore 도메인 데이터 접근 테스트 — vehicles·users 단위 테스트 신설 🧪 ✅

> 2026-07-06, [개선계획서_2026-07](개선계획서_2026-07.md) §6주차~ 지속 트랙 1번(도메인 테스트, 주 1파일). 기존 `src/__tests__/lib/`는 순수 유틸 테스트뿐이고 `src/lib/firestore/`의 데이터 접근 함수(CRUD)에는 테스트가 없던 공백을 메꾸기 시작했다. Opus가 계획서(mock 하네스 설계·스코프 판단) 작성, **Fable 5가 실행**한 첫 분업 작업.

| 항목 | 내용 |
|------|------|
| **신규 테스트** | 1차: `src/__tests__/lib/firestore/vehicles.test.ts`(10건)·`users.test.ts`(18건). 2차(같은 날 연속): `favorites.test.ts`(5건, 사용자 스코프)·`holidays.test.ts`(5건, 서브컬렉션 경로 `organizations/{orgId}/customHolidays` 격리 단언)·`fuelLogs.test.ts`(11건, 기간 조회 상한 200/5,000건 분기+도달 경고 — Phase 71 로직 고정). 조회는 **`where('organizationId','==',orgId)` org 격리 단언 필수**(절대 규칙 1), 변경 함수는 캐시 무효화(`invalidateCache('vehicles')`)·`captureError` 보고+재던짐 고정 |
| **mock 하네스 확립** | `firebase/firestore` 원시 함수 전체 mock — `collection`/`doc`는 `.withConverter()` 체이닝을 위해 자기 자신을 반환하는 ref 스텁(`makeRef`), `serverTimestamp`/`deleteField`는 센티널 문자열, 스냅샷 스텁 헬퍼(`docsSnap`/`getDocSnap`). `cachedQuery`는 fetcher 즉시 실행으로 TTL 우회. 이후 도메인 파일 테스트에 그대로 복제 가능 |
| **스코프 제외(의도)** | `reservations.ts`(runTransaction·writeBatch·오프라인 큐·동시성 분기)와 `driveLogs/mutations.ts`(오프라인 큐)는 mock 복잡도·회귀 위험이 높아 후속 신중 트랙으로 분리. 커버리지 임계치 상향도 테스트가 더 쌓인 뒤 별도 |
| **검증** | Node 22로 tsc·ESLint 0 오류·스코프 테스트 1차 32/32→2차 53/53(기존 `firestore.test.ts` 포함, 중복 없음 확인 — 기존 파일은 트랜잭션 롤백·getDriveLogs 에러 핸들링 담당). 커밋 `a5b00c5`·`aaf9557`(테스트만, 소스 무변경) |

### Phase 88: 동작 줄이기(prefers-reduced-motion) 접근성 대응 ♿ (코드 완료·배포 대기)

> 2026-07-06, [개선계획서_2026-07](개선계획서_2026-07.md) §6주차~ 지속 트랙 3번(접근성 마감). 랜딩 CTA `ctaBreathing`·`liveDot`·`pulseSoft` 등 무한 반복 애니메이션이 시스템 "동작 줄이기" 설정을 무시하던 것을 전역 미디어쿼리로 해소.

| 항목 | 내용 |
|------|------|
| **구현** | `src/index.css` 말미에 `@media (prefers-reduced-motion: reduce)` 블록 — 전 요소 `animation/transition-duration: 0.01ms`·반복 1회로 축소. **로딩 스피너(`.spinner`·`animate-spin`)는 진행 상태 전달 수단이라 예외**로 1.5s 회전 유지(정지 시 멈춘 것처럼 보이는 오해 방지) |
| **지속 트랙 3번 잔여 항목 판정** | 같은 항목의 "Zod 검증 실패 필드·사유 노출"은 **전제 무효 확인** — `driveLogSchema`·`reservationSchema` 전 필드가 `.catch()` 자가 치유라 `parse()`가 ZodError를 던질 수 없고, 사용자 대면 검증은 `validateDriveLogForm`이 이미 한국어 메시지 제공. `.catch()` 제거는 의도된 크래시 방지 설계 변경이라 별도 판단 필요(사용자 확인 대기) |
| **검증** | Node 22 프로덕션 빌드 통과(CSS +0.3KB, 예산 이내), 빌드 산출물에 미디어쿼리 포함 확인. 커밋 `c26e274` |

### Phase 89: 대시보드 수동 갱신 5분 쿨다운 — 연타 재집계 비용 방어 💰 (코드 완료·배포 대기)

> 2026-07-06, Phase 84(서버 캐시 이관) 후속. superAdmin 대시보드 "전체 통계 갱신" 버튼이 누를 때마다 전역 풀스캔 재집계(~1-2만 read)를 무조건 실행 — 연타·다중 superAdmin 동시 클릭이 곧바로 비용으로 이어지는 구멍을 서버·클라이언트 이중 방어로 막았다.

| 항목 | 내용 |
|------|------|
| **서버 쿨다운** | `refreshDashboardStats`에 5분 쿨다운 — 캐시 문서 `lastUpdatedAt`(ISO) **1건 read**로 판정해 창 내 재요청이면 풀스캔을 생략하고 `{ skipped: true, retryAfterSec }` 반환. `lastUpdatedAt`이 NaN(잘못된 값)·미래 시각(시계 스큐)이면 **fail-open**으로 재집계 허용, 캐시 없음(초기 시딩)도 그대로 재집계 |
| **클라이언트** | `useServiceDashboard.refreshServerStats`에 재진입 가드(ref, 스피너 전환 전 같은 프레임 연타 차단) + `skipped` 반환, 생략 시 `loadAllStats` 재로드도 생략(read 절약). `ServiceDashboard`는 결과를 토스트로 안내(성공/쿨다운 대기 분·실패) |
| **토스트 교정** | 최초 작성분이 `react-hot-toast`를 import했으나 **`<Toaster>`가 앱에 미마운트라 화면에 아무것도 표시되지 않는 죽은 호출**이었음 — superAdmin 타 컴포넌트 5곳과 동일한 커스텀 `useToast`로 교체(지속 트랙 4번 잔재 확대 차단) |
| **검증** | functions Jest 7건 신규(비인증·비superAdmin 거부, 초기 시딩 재집계, 쿨다운 내 생략+retryAfterSec 범위, 경과 후 재집계, NaN·미래 시각 fail-open 2종) + functions tsc·루트 tsc·ESLint·관련 프론트 테스트 156건 통과. 커밋 `f790b57` |

### Phase 90: react-hot-toast 잔재 제거 — 죽은 토스트 커스텀 통일 + 패키지 제거 🧹 (코드 완료·배포 대기)

> 2026-07-06, [개선계획서_2026-07](개선계획서_2026-07.md) §6주차~ 지속 트랙 4번. react-hot-toast의 `<Toaster>`가 앱 어디에도 마운트돼 있지 않아 `toast()` 호출이 **화면에 아무것도 표시하지 않는 죽은 코드**였던 잔재 2곳을 커스텀 토스트로 통일하고 패키지를 제거했다.

| 항목 | 내용 |
|------|------|
| **교체 2곳** | ① `App.tsx` AppCheck 스로틀 안내 → `notifyUser`(비-React 브릿지). 기존 `id: 'appcheck-error'` 중복 방지는 커스텀 스토어에 id 개념이 없어 **표시 시간(5s) 내 재알림 억제** 클로저 가드로 대체(unhandledrejection 연발 대응). ② `PublicFeedbackModal` 문의 폼 검증·결과 → `useToast`(훅 규칙상 조기 return 위에서 호출) |
| **랜딩 사각지대 해소** | `PublicFeedbackModal`은 lightEntry(비인증 랜딩)에서 렌더되는데 `ToastProviderWrapper`가 appEntry에만 마운트돼 있었음 — **경량 엔트리에도 마운트**(zustand 스토어만 쓰는 컴포넌트라 lightEntry +0.1KB, 경량 취지 유지). 렌더 경로 이중화 환경에서 "이름을 입력해주세요" 등 문의 폼 피드백이 실제로 보이게 됨 |
| **패키지·문서** | `npm uninstall react-hot-toast` — 전체 JS 번들 2925.5→2917.1KB(-8.4KB, appEntry 92.1→90.6KB). CLAUDE.md "사용자 메시지는 react-hot-toast" 규칙을 커스텀 토스트(`useToast`/`notifyUser`) 기준으로 현행화 |
| **검증** | Node 22 tsc·ESLint·프로덕션 빌드(예산 이내)·lint-staged 관련 테스트 통과. `grep react-hot-toast src/ package.json` 0건. 커밋 `882e83a` |

### Phase 91: GitHub Actions 무료 분량 소진 대응 — 문서 푸시 CI 스킵 + 낡은 CI 자동 취소 💰

> 2026-07-06, GitHub 90% 사용 경고(1,801/2,000분, 8/1 리셋) 대응. 실측 결과 **푸시 1회 ≈ 20분**(CI 평균 15.6분 + Deploy 4.1분)인데, 문서 한 줄짜리 `chore:` 푸시도 매번 풀 사이클(테스트·에뮬레이터·E2E·배포)을 태우고 있었다. 이날 하루 8회 푸시 ≈ 150분 소진이 대표 사례.

| 항목 | 내용 |
|------|------|
| **문서 푸시 CI 스킵** | `ci.yml` push 트리거에 `paths-ignore: docs/**, **.md` — 문서 전용 푸시는 CI가 아예 안 돌고, Deploy는 CI 성공(workflow_run)에만 이어지므로 자동으로 함께 스킵. 코드와 섞인 푸시는 정상 실행. 트레이드오프: `.md` 전용 변경의 `sync --check`는 다음 코드 푸시에서 검증(1인 운영 규모에서 수용) |
| **낡은 CI 자동 취소** | `concurrency: ci-${{ github.ref }}` + `cancel-in-progress: true` — 연속 푸시 시 직전 CI를 취소하고 마지막 것만 완주. 취소된 CI는 success가 아니므로 Deploy로 이어지지 않아 중간 버전이 배포되는 일 없음(기존 Deploy 쪽 순차 큐는 유지) |
| **운영 습관** | 커밋은 작게 유지하되 **푸시는 작업 단위로 모아서 1회** — 코드+문서를 한 푸시로 묶으면 사이클 1회만 소비. 에이전트 메모리에도 기록 |
| **잔여 판단(사용자 몫)** | ① Actions 예산 설정 — $0(초과 시 배포까지 하드 차단) vs 소액(초과분 분당 $0.008, 100분 ≈ $0.8) → **사용자가 $10 예산 설정 완료** ② 레포 public 전환 시 분량 무제한 무료이나 git 이력 보안 감사 선행 필요 — 이번 스코프에서 제외 |

### Phase 92: firestore 예약·운행일지 쓰기 도메인 테스트 — 지속 트랙 1번 완결 🧪 (코드 완료·배포 대기)

> 2026-07-06, [개선계획서_2026-07](개선계획서_2026-07.md) §6주차~ 지속 트랙 1번의 마지막 잔여분. Phase 87에서 신중 트랙으로 분리했던 고위험 2파일(`reservations.ts`·`driveLogs/mutations.ts`)을 Opus 계획서(mock 함정 선해결) + Fable 실행 분업 2회차로 처리. **35건 전부 첫 실행에 통과.**

| 항목 | 내용 |
|------|------|
| **신규 테스트** | `reservations.test.ts`(23건) — org 격리(`getReservationByIdAndOrg` 교차 테넌트 차단), 비-트랜잭션 상태 변경 온/오프라인 분기, `rejectReservation` 트랜잭션 성공 경로, 그룹 배치 취소/삭제(활성만), `createReservationSafe` 콜러블(비즈니스 에러 Sentry 제외). `driveLogsMutations.test.ts`(12건) — 온/오프라인 CRUD(오프라인 큐 CREATE/UPDATE/DELETE), `REQUIRES_START_KM_CONFIRMATION` 확인 에러(Sentry 미보고), 결정론적 id 멱등성 |
| **mock 함정 3종 (계획서가 선해결)** | ① 오프라인 경로가 `setDoc/updateDoc/deleteDoc` 반환값에 `.catch()`를 붙이므로 mock이 반드시 Promise 반환(기본 `vi.fn()`은 undefined라 크래시) ② `navigator.onLine`은 `defineProperty` getter로 토글 ③ `enqueue`(idb) 미mock 시 hang. `vi.clearAllMocks()`가 구현까지 지우므로 beforeEach에서 Promise 반환 재설정 |
| **중복 방지** | 기존 `firestore.test.ts`가 덮는 `updateReservationStatus` 트랜잭션 에러 2건(문서 없음·동시성 충돌)은 재작성하지 않고 비-트랜잭션 경로만 커버. recurring 그룹 2종은 동일 `batchGroupAction` 헬퍼라 cancel/delete 각 1건으로 대표 검증 |
| **커버리지 임계치 2단계** | 실측 lines 26.57→**28.08** — 계획 목표 28은 마진 0.08pp라 위험, 안전 마진 ~1pp 원칙으로 **27/26/21/16** 상향(26/25/20/15에서) |
| **검증** | Node 22 tsc·ESLint 0오류, firestore 스코프 8파일 88건·전체 556건 통과. 커밋 `ccdab94` |

### Phase 93: 외부 감사(GPT 5.6) 검증·조치 — 멀티테넌트 쓰기 격리·OAuth 토큰·비활성 차단 🔐 (코드 완료·배포 대기)

> 2026-07-10, 사용자가 외부 모델에 보안 점검을 의뢰해 받은 8건 + 하드닝 3건을 지목 라인·실제 코드로 직접 대조 검증(환각 없음)한 뒤 실재 취약점을 배포 표면별(배치 A: rules / 배치 B: functions·client)로 분리 조치. 상세: [security-reports/2026-07-10](security-reports/2026-07-10.md).

| 항목 | 내용 |
|------|------|
| **배치 A (rules)** | ① 차량·운행일지·예약·주유·하이패스·정비 admin update에 `organizationId` 불변 공통 강제(2026-07-04 N1을 형제 컬렉션으로 확장, #6) ② `organizations` 클라이언트 create를 `isSuperAdmin()` 전용 잠금(승인 우회 차단, #2) ③ 예약 create 콜러블 전용화 + 소유자 `pending→reserved` 자가 승인 차단(#5) ④ `users/{uid}/private/*` Functions 전용(`if false`) 서브컬렉션 추가(#4) |
| **배치 B (functions·client)** | ⑤ `disableUser`에 Auth 비활성화 + `revokeRefreshTokens`(#1) ⑥ `downloadFileAsBase64` 경로 prefix 강제 + `autoVerifyDocument`가 트리거 `organizations/{orgId}/`만 다운로드, 테스트 화이트리스트 `ALLOW_TEST_WHITELIST` env 게이팅(#3·#2) ⑦ Google OAuth 토큰을 `users/{uid}/private/oauth`로 이전 + 마이그레이션 스크립트 + 죽은 클라이언트 토큰 함수·Sentry `oauthData` 제거(#4) ⑧ `logout`에서 `clearQueue()` + `clearOfflineCache()` 후 루트 리로드(#8) |
| **하드닝** | `security-audit.ts` fail-closed 전환 — 실행/파싱 실패를 0건으로 위장하지 않고 `exit(1)`, High도 CI 실패 처리 |
| **표현 보정** | #2는 기존 admin 보유 기관 탈취 불가(자기 기관 무검증 생성이 실질), #6은 반신뢰 admin의 무결성 침해(탈취 아님). App Check(#7)는 계획서 진행 트랙이라 제외 |
| **검증** | rules 에뮬레이터 12/12(신규 5-1·9·10·11), 프론트 단위 551 · Functions 단위 251(disableUser 신규 포함), Node 22 tsc·ESLint 0오류, 빌드 번들 예산 내 |
| **배포 후 필수** | `npx tsx ../scripts/migrateGoogleOauthToPrivate.ts`(functions에서, 멱등)로 기존 `googleOauth` 필드 이전 |

### Phase 94: 2026-07-10 품질 개선 위험순 티어링 — E2E 결정성·App Check 1배치·임계경로 커버리지·게이트 🧪 (코드 완료·배포 대기)

> 2026-07-10, 외부(GPT 5.6) 개선계획서를 실제 코드와 대조 검증 후 규모에 맞게 위험순 3티어로 재정렬해 실행. Phase 93 보안 수정에 이어 회귀 방어·품질 게이트를 강화. 마이그레이션 스크립트 안전장치(dry-run/verify-only + 정직한 종료 코드)도 함께 반영.

| 항목 | 내용 |
|------|------|
| **인증 E2E 결정성** | 차량 시드 필수 필드 `modelName` 추가·`merge` 제거(잔존 필드 차단), 단일 워커 직렬 실행·CI 재시도 1회, 콜드스타트 `drive-log` goto 리다이렉트 중단을 `toPass` 재시도로 결정화, `[Zod]` 시드 계약 위반 콘솔 수집·0건 단언. 로컬 3회 연속 8/8·Zod 0 |
| **App Check 1배치** | 운영/superAdmin onCall 8종(`backfillMonthlyStats`·`backfillOrgCoords`·`cleanupDuplicateLogs`·`recalculateAggregatedStats`·`refreshDashboardStats`·`regenerateFeedbackDraft`·`sendBulkReminder`·`apiHealthCheck`)에 `enforceAppCheck: true`. 배포 후 2영업일 관찰 게이트, 이상 시 배치만 false 복원. 2·3배치·공개 callable 예외는 후속 |
| **임계경로 커버리지** | `logout`(순서·실패 격리, 감사 #8)·오프라인 큐(enqueue/clearQueue/flush 성공제거·실패보존, fake-indexeddb)·예약 제출 `handleSubmit`(검증 차단·생성 건수·already-exists) 신규. 하한 lines 28/stmts 27/branches 17로 상향(실측 29.12/27.89/17.83) |
| **접근성·번들 게이트** | axe-core 공개 라우트 검사(serious/critical 게이트, color-contrast는 기존 디자인 부채로 리포트만), 무의미 `count>=0` 단언 제거·aria-live `>=1`, ConfirmModal 포커스 트랩 컴포넌트 테스트, 번들 gzip(JS 950·CSS 35KB)·최대 청크(420KB) 예산 추가 |
| **문서·CI** | PROJECT.md 이관 경로 4건·OAuth 설명 현행화, CI·Deploy 워크플로 `permissions: contents: read` |
| **의도적 미채택** | prebuild `--strict` 강제(engines 22.x·CI 22 이미 확보, 실익 낮음), Deploy verify job 추가(배포 job이 이미 build·test·audit 재실행 + CI 성공 workflow_run 게이트) |
| **검증** | 프론트 단위 573 · Functions 251 · Rules 12 · 인증 E2E 8/8×3 · 빌드 gzip 게이트 통과 · audit 0건, Node 22 |

### Phase 95: 2026-07-11 보안 개선 — PII 로그 마스킹·MIME 화이트리스트·Rate Limit fail-closed·defineSecret 이관 🔐 (코드 완료·배포 대기)

> 2026-07-11, Claude 재평가(84.2점)에서 코덱스 개선계획 작업 2·3 + 신규 지적 2건(PII 평문 로그, defineSecret 미사용)을 조치. App Check 2·3배치는 Authentication 미검증 30%(인앱 브라우저 App Check 미초기화 경로 확인)로 보류 — 함수별 메트릭 확인 후 진행. GOOGLE_OAUTH_CLIENT_SECRET은 배포 환경에 값 자체가 부재하고 개인 캘린더 토큰 갱신이 휴면(레거시) 상태임을 확인해 이관에서 제외(3종만).

| 항목 | 내용 |
|------|------|
| **PII 로그 마스킹** | `utils/mask.ts` 신설(`maskPhone` 추가, `maskName`/`maskEmail`을 verifyHelpers에서 승격·re-export 호환 유지). 알림톡 발송 로그 전화번호+이름 3곳, 이메일 평문 로그 11곳(verifyHelpers·submitOrgApplication·sendApproval/RejectionEmail·restoreUser·calendarSchedule) 마스킹. mask.test.ts 신규 |
| **MIME 화이트리스트 (작업 3)** | `submitOrgApplication`에 jpeg/png/webp/pdf 허용표 + 확장자·contentType 정합 매핑(기존: 캘러 MIME 무검증 저장, png도 .jpg 확장자). 프론트는 이미지→JPEG 압축·PDF 원본이라 정상 신청 영향 없음. 매직바이트 검증은 계획서 결정대로 미채택. 거부/통과 테스트 9건 신규 |
| **Rate Limit fail-closed (작업 2)** | `failMode?: 'open'\|'closed'` 옵션(기본 open — 기존 호출부 보존). 고위험 5곳(`askAI`·`ocrDashboard`·`ocrDocument`·`submitOrgApplication`·`submitPublicFeedback`) closed 지정, `checkDailyOcrQuota`는 항상 closed. `wrapCallableHandler`에 `rateLimitFailMode` 전달 옵션. 계약 테스트 rateLimitFailMode.test.ts 신규(open 통과/closed 거부/정상 경로) |
| **defineSecret 이관** | GMAIL_APP_PASSWORD·EMAILJS_PRIVATE_KEY·ALIMTALK_PROXY_TOKEN 3종을 `core/params.ts` 중앙 defineSecret로 이관, 소비 함수 9곳 `secrets` 바인딩(이메일 4·알림톡 5·autoVerifyDocument 포함). 서비스 코드는 process.env 읽기 유지(바인딩 시 주입). GOOGLE_OAUTH_CLIENT_SECRET은 배포 env에 값 부재 + 토큰 갱신 경로 휴면 확인으로 제외(예약 트리거 바인딩 원복) — OAuth 정리는 기존 계획 트랙에서 별도 |
| **커밋 분리** | `27e2b21`(마스킹·MIME·fail-closed — 즉시 배포 가능) / `7c15fb6`+후속(defineSecret — **시크릿 3종 사전 등록 + 배포용 env에서 동일 키 제거 전 푸시 금지**, 미이행 시 CI Deploy 실패) |
| **검증** | Functions 31 suites/284 테스트(신규 3파일 포함)·tsc·빌드·ESLint 0오류, Node 22 |
| **배포 전 필수** | `firebase functions:secrets:set` 3종(GMAIL_APP_PASSWORD·EMAILJS_PRIVATE_KEY·ALIMTALK_PROXY_TOKEN) → GitHub Secret `FUNCTIONS_ENV_FILE`에서 동일 키 제거(로컬 .env엔 원래 없음) → 푸시 |

### Phase 96: 캘린더 → 앱 동기화 UX — 수동 동기화 버튼·홈 트리거·예약자 폴백 📅 (코드 완료·배포 대기)

> 2026-07-12, 사용자가 구글 캘린더(차량 캘린더)에 직접 등록한 일정(7/13 합정역)이 앱 예약에 반영되지 않는다는 보고. 조사 결과 기능 자체는 정상이나 폴링 pull 트리거의 구조적 사각지대(스케줄러 `0 6-22 * * 1-5` 평일 전용 + 온디맨드가 예약 캘린더 화면에만 트리거 + 홈 '내 예약'은 당일만 표시)가 원인. 실시간 Webhook(watch)은 1인 운영 규모에 과설계로 기각, [개선계획서_캘린더동기화_2026-07](개선계획서_캘린더동기화_2026-07.md) 확정 후 빠른 개선 3종 구현 (계획 Opus / 실행 Fable 분업).

| 항목 | 내용 |
|------|------|
| **A. 수동 동기화 버튼** | 예약 캘린더 헤더에 '🔄 지금 동기화' + '마지막 동기화 HH:mm' 표시(연동 차량 존재 시에만). `useCalendarSync`에 `force` 옵션(수동은 30분 쿨다운 우회)·`getLastSyncTime` 추가, `useReservationData.syncNow`가 연동 차량 전체 동기화 후 예약 리프레시 + 토스트 |
| **B. 홈 진입 트리거** | `TodayDashboard` 마운트 시 온디맨드 백그라운드 동기화(30분 쿨다운 유지로 비용 방어). `useTodayDashboard`에 `refresh()`(캐시 무효화 + refreshTick 재페치) 추가, 동기화 성공 시 대시보드 갱신 — 재페치로 vehicles 참조가 바뀌어도 쿨다운이 재동기화 루프 차단 |
| **C. 예약자 폴백 체인** | `calendarSchedule.ts` 생성 분기: Auth displayName → Firestore `users.name` → 이메일 로컬파트 순 폴백(이메일 전체 미저장). 자유형식 제목('합정역')도 예약자 미상으로 남지 않음. `VehicleCalendarSection` 안내문에 직접 등록 권장 제목 형식(`목적지 — 예약자`) 추가 |
| **회귀 테스트** | `calendarReverseSync.test.ts` 신규 8건 — 파서(표준 형식·description 우선·자유형식·종일 이벤트) 4건 + 폴백 체인(displayName·프로필 name·미가입 로컬파트·표준 제목 유지) 4건 |
| **커밋 분리** | `271a259`(Functions 폴백+테스트) / `30b167b`(프론트 A·B·C-2) |
| **검증** | ESLint 0오류·tsc·빌드(번들 예산 이내)·프론트 576·Functions 292(신규 8건 포함), Node 22 |
| **하지 않은 것** | 실시간 Webhook(watch 채널 등록·갱신 스케줄러·syncToken 유지 부담), 주말 스케줄 확장(A·B로 사용자 진입 시 반영되므로 함수 호출 비용 증가 회피 — 관찰 후 필요 시) |

### Phase 97: iOS IndexedDB Sentry 노이즈 필터 + 오프라인 큐 flush 트랜잭션 버그 + websocket-driver CVE 🐛🔐 (푸시 완료·CI 배포)

> 2026-07-16, Sentry `UnknownError: Attempt to delete range from database without an in-progress transaction`(iOS Chrome/WebKit, `/employee/today`, unhandledrejection) 보고. 조사 결과 우리 코드가 아닌 Firebase 영속성 레이어 발 WebKit IDB 노이즈로 확진(iOS는 Background Sync 미지원 `'SyncManager'` 부재로 자체 flushQueue 경로 미실행)했고, 조사 중 flushQueue의 실제 트랜잭션 버그를 별도 발견했다. 푸시 시 신규 websocket-driver Critical CVE가 pre-push 감사를 막아 함께 패치.

| 항목 | 내용 |
|------|------|
| **A. Sentry 노이즈 필터** | `src/lib/sentry.ts` `ignoreErrors`에 `/Attempt to delete range from database without an in-progress transaction/` 추가. 스택 프레임이 없어 기존 `firebase-*` 번들 `beforeSend` 필터를 우회하던 unhandledrejection 케이스. 기존 iOS IDB 노이즈 항목 옆에 묶어 배치 |
| **B. flushQueue 트랜잭션 버그** | `src/lib/offline/syncQueue.ts` — 단일 `readwrite` 트랜잭션을 걸쳐 Firestore 쓰기를 `await`하면서 트랜잭션이 auto-commit·비활성화된 뒤 `store.delete`가 실패하던 버그 수정. 읽기·삭제를 각각 독립된 짧은 트랜잭션(`database.getAll`/`database.delete`)으로 분리. Chromium(Background Sync 지원)에서 발현되는 별개 결함 |
| **C. websocket-driver CVE** | `0.7.4 → 0.7.5` non-breaking 패치(GHSA-mp7j-qc5w-4988·GHSA-xv26-6w52-cph6). firebase/firebase-admin → @firebase/database → faye-websocket 경유 transitive, 프론트·functions 양쪽. `npm audit fix`로 lockfile만 변경, audit 0 |
| **커밋 분리** | `2d70362`(fix: A+B) / `d8f7f78`(fix(deps): C) |
| **검증** | tsc·ESLint·프론트 576 테스트·보안 감사(프론트/functions 취약점 0), Node 22 |
| **하지 않은 것** | flushQueue를 이번 iOS 리포트 원인으로 오귀속하지 않음(iOS 미실행 경로). 별개 WIP(ci.yml·deploy.yml·firebase.json·VehicleCalendarSection) 미포함 |

### Phase 98: 기관별 기능 사용 설정 + 입력 방식 선택 + 업데이트 소식 인앱 노출 ⚙️📢 (푸시 완료·CI 배포)

> 2026-07-17, 기관 규모 편차(212개 중 다수가 1~2명)에서 소규모 기관엔 하이패스·정비·운전자 지정 등이 대부분 불필요한 노이즈라 "이건 뭐냐"는 문의가 반복됐다. 관리자가 **기관 단위로 기능을 켜고 끄고, 동승자·운전자 입력 방식까지 고를 수 있게** 하고, 그동안 공개(로그인 전) 페이지에만 링크돼 로그인 사용자가 사실상 못 보던 **업데이트 소식을 앱 안에서 노출**했다. 앞선 2026-07-17 운전자 지정 기능(커밋 `b86b2e5`~`6e005e9`) 위에 이어진 작업.

| 항목 | 내용 |
|------|------|
| **A. 기능 사용 설정** | `Organization`에 boolean 플래그 다수 추가(미설정=켜짐 규칙 → 기존 212개 기관 무영향). `src/lib/orgFeatures.ts` `resolveOrgFeatures`가 `!== false`로 해석, `AuthProvider`가 기관 문서 실시간 구독으로 노출. 관리자 설정에 `FeatureToggleSection` 신설 — 차량 예약/차량 관리/차량 등록 옵션/운전자 기록/동승자 **도메인 그룹**으로 묶고 각 방식 옵션을 관련 기능 바로 아래 들여쓰기 배치 |
| **B. 입력 방식 개별 토글** | 동승자(직원 직접선택·검색·인원 숫자)·운전자 대표/공동(목록·검색)을 개별 on/off, 최소 1개 유지 가드. 운전자는 둘 다 켜면 후보 8명 기준 목록/검색 자동 전환(작은 기관은 검색창 숨김). 수리·정비 '일반 직원도 사용' 옵션(끄면 관리자 전용) |
| **C. 슈퍼관리자 반영** | `useAuth`의 기관 구독을 `role==='superAdmin'`에도 허용(본인 기관 토글이 슈퍼관리자 화면에 반영되도록). soft-delete 로그아웃(`orgDeleted`)은 슈퍼관리자에 미적용 |
| **D. 게이팅 지점** | DriveLogForm(운전자/동승자/하이패스)·DriverSection·PassengerSection·VehicleStatusSection·FuelLogTab(하이패스/정비 탭·역할)·VehicleForm(사용 가능 직원·캘린더)·AdminLayout(하이패스/정비 메뉴). 예약 관리자 승인을 기능 설정으로 통합(ReservationApprovalSection 제거) |
| **E. 중복 검사 이동** | 운행일지 목록 상단 상시 버튼 → 오른쪽 위 ⋮ 더보기 메뉴로 이동(자동 중복 방지로 상시 필요성 낮음). 메뉴에 용도 설명 추가, 기능 자체는 유지 |
| **F. 업데이트 소식 인앱** | `useReleaseNotesStatus`(최신 릴리즈 날짜 vs localStorage 비교, 이벤트로 배지 동기화) + `ReleaseNotesModal`(다크모드 유지·최근 7일 기본·이전 소식 펼치기) + `ReleaseNotesBanner`(첫화면). 직원 더보기 항목·하단 탭 점·관리자 헤더 📋, 확인 시 전 배지 해제 |
| **문서** | FAQ `duplicate-check` 항목 추가(중복 검사 용도·사용법·주의), 업데이트 소식(releaseNotes.json) 2건 — 기능 사용 설정·입력 방식·중복 검사 이동 안내 |
| **커밋** | `372c436`(feat 기능 설정)·`b3a20a3`(refactor 중복 검사)·`d86834b`(feat 업데이트 소식)·`8811dc2`(docs) |
| **검증** | tsc·ESLint·프론트 588 테스트·빌드(번들 예산 이내), Node 22. Rules 미변경(플래그는 org 문서 필드, 마이그레이션 불필요) |
| **하지 않은 것** | 전체 기관 브로드캐스트 공지(슈퍼관리자→200개 인앱/푸시)·알림톡/이메일 안내는 사용자 선택으로 보류(업데이트 소식 갱신만 채택). 끄기는 "입력·진입 숨김"이지 데이터 삭제가 아니라 과거 기록·PDF/Excel·통계는 그대로 |

### Phase 99: Slack 자연어 차량 예약 어시스턴트 (파일럿) 🤖💬 (푸시 완료·CI 배포)

> 2026-07-18, Slack DM에서 자연어로 예약을 조회·생성하는 파일럿(단일 워크스페이스, 향후 Google Chat·운영현황 질의 확장 대비). 플랫폼 독립 코어 + Slack 어댑터로 경계를 나눠 재작업 없이 확장 가능하게 설계. 예약 생성의 권위 로직은 기존 `createReservationSafe`에서 추출해 콜러블·봇이 공유.

| 항목 | 내용 |
|------|------|
| **A. 예약 코어 추출** | `createReservationSafe` 콜러블의 트랜잭션 본문(락+시간충돌+org격리+allowedUserIds)을 `services/reservation/createReservationCore.ts`의 `createReservationTx({...,actorUid,actorOrgId})`로 무변경 이동. 콜러블은 인증+주입만 하는 얇은 래퍼로 축소. 기존 콜러블 테스트 무수정 통과가 회귀 가드(독립 커밋 `c2b3c94`로 격리 배포) |
| **B. 어시스턴트 코어(플랫폼 독립)** | `services/assistant/` — `parseIntent`(Gemini JSON 파싱: Asia/Seoul 현재일·org 차량목록 주입, `responseMimeType:json`·temp 0, **LLM 출력 서버 재검증**: 날짜/시간 형식·과거일·존재 차량·start<end), `queryReservations`(org+date 조회→텍스트 요약, 기존 인덱스 재사용), `handleAssistantMessage`(오케스트레이터: 조회 즉시응답 / 생성은 proposal 반환). Slack 타입 없음 → Google Chat 재사용 가능 |
| **C. Slack 어댑터** | `services/slack/` — `verifySlackSignature`(v0 HMAC+timestamp ±5분, `checkSlackSignature`가 실패 사유 반환), `slackApi`(fetch 기반: postMessage/**users.info(form-urlencoded)**/reactions.add/response_url), `resolveSlackUser`(이메일→`getUserByEmail`→uid 매핑+`slackUsers` 캐시, 소속·활성 매번 재검증). 수신 `handlers/https/slackEvents`(서명검증→`slackTasks` 문서 create→즉시 200, event_id 멱등), 워커 `handlers/triggers/onSlackTaskCreated`(신원→rate limit(fail-closed)→코어→응답). 3초 ack 제한을 task 문서+onCreate 트리거로 우회(`generateFeedbackDraft` 동형) |
| **D. 오파싱 방지·UX** | 생성은 파싱 요약 + `[예약 확정][취소]` Block Kit 버튼 확인(`slackConfirmations` 10분 TTL, 클릭자==요청자 검증, 버튼도 task 위임 후 `response_url` replace). 메시지 접수 즉시 `eyes` 리액션으로 처리중 신호 |
| **E. 보안·격리** | 봇은 admin SDK로 Rules 우회 → 신원 org == `integrations/slack_{teamId}` org == 예약 organizationId 3중 검증이 방어선. `SLACK_SIGNING_SECRET`·`SLACK_BOT_TOKEN` defineSecret, rate limit `slackAssistant`(10/10분)·`slackAssistantDailyOrg`(100/일). 신규 컬렉션(`integrations`/`slackUsers`/`slackTasks`/`slackConfirmations`) Rules 클라이언트 전면 차단 |
| **디버깅 여정** | 배포 IAM 2건(새 시크릿 secretAccessor·새 공개 HTTP setIamPolicy → [troubleshoot-deployment §2.5](../.agent/skills/troubleshoot-deployment/SKILL.md)), 서명 시크릿 오등록(재설정), **`users.info` JSON 본문 미파싱으로 user_not_found**(읽기 API는 form-urlencoded 필수 — 핵심 수정 `fd9caf1`). 진단 로그(서명사유·신원·auth.test)로 원인 축차 규명 후 auth.test 진단 제거 |
| **커밋** | `c2b3c94`(refactor 코어)·`6efd7a5`(feat 어시스턴트+어댑터)·`fd9caf1`(fix users.info form)·`810a809`(feat 리액션) + 진단 chore 3·test 1 |
| **검증** | functions 단위 테스트(코어·서명·파싱·오케스트레이터·수신·워커) + 프로덕션 엔드투엔드 실증: 조회(예약 현황), 생성(소나타3333 09~10시 확인버튼→앱·캘린더 반영), 시간충돌 정상 거부. Node 22 |
| **설계 결정** | 파일럿=단일 워크스페이스 고정 매핑(콘솔 `integrations` 문서 1건). 멀티테넌트 셀프서비스(OAuth 설치+워크스페이스별 토큰)·Google Chat 어댑터·운영현황 질의·멀티턴 대화 기억은 후속(코어/어댑터 경계로 재작업 최소화). 멀티턴은 단일 메시지로 충분해 실사용 관찰 후 판단 |
| **하지 않은 것** | 멀티턴 대화 상태(여러 메시지 이어받기), 채널 멘션(app_mention — DM 전용), 예약 취소/수정 intent, OAuth 멀티 워크스페이스 배포 |

### Phase 100: Slack 멀티테넌트 셀프서비스 — OAuth 설치·기관별 암호화 토큰·연결 설정 UI 🔗🏢 (푸시 완료·CI 배포)

> 2026-07-18, Phase 99 파일럿(단일 워크스페이스 콘솔 수동 매핑)을 **210개+ 기관이 스스로 연결하는 멀티테넌트 셀프서비스**로 확장. 관리자가 설정에서 "Slack 연결" 버튼 한 번으로 자기 워크스페이스를 붙이고 `team_id`로 기관·토큰이 자동 분기된다. 코어(`handleAssistantMessage` 등)는 무변경 재사용. (Phase 99 이후 멀티턴 대화 기억도 추가됨 — 커밋 `c52a808`, 되묻기 사이 예약 슬롯 유지)

| 항목 | 내용 |
|------|------|
| **A. 기관별 암호화 토큰** | 전역 `SLACK_BOT_TOKEN` → `integrations/slack_{teamId}.tokenCipher`에 **AES-256-GCM 암호화**(마스터키 `SLACK_TOKEN_ENC_KEY`, AAD=`slack_{teamId}`로 문서 바인딩). `core/crypto` + `services/slack/tokenCrypto`. `getSlackIntegration`이 복호화 토큰 반환, 워커가 그 토큰 사용. **무중단 전환**: 배포 전 `scripts/migrateSlackToken`로 기존 토큰을 암호화(구 워커는 신규 필드 무시). Cloud KMS는 규모상 배제(의존성 0·로컬 복호화). 커밋 `a9f8ec4` |
| **B. OAuth 셀프서비스 설치** | 배포형 앱 1개 OAuth v2. `getSlackInstallUrl`(콜러블·admin: organizationId를 **인증 토큰(orgId 클레임)**에서 확정 → 서명 state에 담아 브라우저 조작 차단, 1회성 nonce `slackOauthStates` 기록) + `slackOauthCallback`(onRequest: state HMAC·TTL 검증 → nonce 트랜잭션 소비(재생 차단) → `oauth.v2.access` code 교환 → 토큰 암호화 저장 → `/admin/settings?slack=connected` 복귀, **중복 바인딩(다른 기관 연결) 거부**). `services/slack/oauthState`(순수 HMAC+TTL). 커밋 `4ce8e45` |
| **C. 연결 설정 UI** | `settings/SlackIntegrationSection` — 미연결(예시 대화 말풍선 + 연결 전 확인 3가지, ⚠️ 직원 이메일 일치 강조) / 연결됨(워크스페이스·연결일 + **직원 준비 상태 진단** + 사용법 + 연결 테스트·2단계 해제). 콜러블 `getSlackConnectionStatus`(**안전 필드만**·토큰 미반환)·`disconnectSlack`(auth.revoke→`tokenCipher` 삭제)·`diagnoseSlackConnection`(`users.list` 이메일 대조 = 최다 실패 원인 사전 진단 + 연결 테스트 겸용). `useSlackIntegration` 훅(설치 URL 이동·`?slack=` 복귀 토스트). 커밋 `198b25d` |
| **D. 정리** | `SLACK_BOT_TOKEN` defineSecret 제거(참조 0 확인, Secret Manager 폐기 대상). 기관 온보딩 가이드는 **인앱 카드 자체**가 수행 — 교육 스크립트는 "설정 → Slack 연결 → 허용" 한 줄 |
| **보안·격리** | 봇 토큰=워크스페이스 탈취 → 저장 암호화(AAD 바인딩)·무로깅·클라 미반환·워커에서만 복호화(핵심 위협 "Firestore 덤프"는 키가 DB 밖 Secret Manager라 차단). OAuth state = 전용 `SLACK_STATE_SECRET` HMAC + 단기 TTL + nonce 1회성 + org 서버 mint. 모든 설정 콜러블 admin 게이트·org는 토큰 클레임. Phase 99의 신원 3중 검증 유지 |
| **운영 IAM** | 새 시크릿 4개(`SLACK_TOKEN_ENC_KEY`/`SLACK_CLIENT_ID`/`SLACK_CLIENT_SECRET`/`SLACK_STATE_SECRET`) 모두 배포 전 compute SA에 `secretmanager.secretAccessor` 수동 부여 필요([§2.5](../.agent/skills/troubleshoot-deployment/SKILL.md) 재현 — 안 하면 배포가 setIamPolicy 403) |
| **검증** | 단위: crypto 8·oauthState 9·resolveSlackUser 6·콜백 6·설정 콜러블 15·워커 갱신·프론트 컴포넌트 6 (functions 전체 그린). 프로덕션 **E2E 실증**: 설정→[Slack 연결]→OAuth 허용(Socialprism)→연결됨 + 직원 준비 상태 진단(11명 중 3명 이메일 매칭) 표시. 무중단 전환·재연결 확인. Node 22 |
| **후속** | Google Chat 어댑터(동일 셀프서비스 뼈대 + Chat OAuth/카드), 예약 취소/수정 intent, 운영현황 질의, 토큰 암호화 KMS 승격 |

### Phase 101: 메신저 어시스턴트 데이터 자유질의(qa) 모드 🔍💬 (푸시 완료·CI 배포)

> 2026-07-19, 어시스턴트가 `query`(특정 하루 목록)·`create`(예약 생성)로 분류되지 않던 **자유 질문**("홍길동이 예약한 차", "이번주 예약 누가 했어", "우리 기관 차량 뭐 있어", "화요일에 마지막에 예약한 사람")에 답하지 못하고 엉뚱하게 그날 예약 현황만 반환하던 문제를 해결. 손코딩 의도를 늘리는 대신 **자기 기관 ±1개월 예약 창 + 차량 목록을 LLM에 근거로 주고 답하게 하는** `qa` 의도를 추가. 플랫폼 독립 코어라 슬랙·구글 챗 양쪽 적용.

| 항목 | 내용 |
|------|------|
| **의도 추가** | `parseIntent`에 `qa` 분류 추가(사람/차량 필터·기간·개수·"가장/마지막"·차량 목록). `query`(특정 하루 나열)와 경계 명시. `qa`는 날짜·슬롯 불필요 → 재검증·멀티턴 병합 스킵하고 그대로 반환(조회성 질문을 진행 중 create에 이어붙이지 않음) |
| **응답 코어** | 신규 `services/assistant/answerDataQuestion`: 기관 스코프 + `date` 범위(오늘 ±31일)로 예약 조회(취소·반려 제외, 상한 400건·초과 시 최근 우선·로그) → 차량 목록과 함께 가드레일 프롬프트 구성 → Gemini(`temperature 0`)로 자연어 답변 + "🔎 최근 1개월~향후 1개월 예약 기준" 푸터. `handleAssistantMessage`에 `qa` 분기(멀티턴 폐기 후 호출)·도움말 예시 추가 |
| **안전·정확성** | **환각 방지**: 주어진 데이터에만 근거·없으면 "찾지 못했습니다"·범위 밖 안내·인젝션 방어(`sanitizePromptValue`)·`temperature 0`. 예약 0건이어도 차량 질문은 답하도록 항상 호출(빈-창 스킵 최적화 배제 — 오답 방지). **멀티테넌트**: 창 조회 `organizationId` equality 필수 |
| **인프라** | 기존 복합 인덱스 `reservations(organizationId, date)` 재사용(범위 조회) → 새 인덱스·`index.ts` 등록 불필요(내부 서비스 모듈) |
| **검증** | 단위: `answerDataQuestion` 8(창 조회 org 한정·취소반려 제외·근거규칙·차량목록·temp0·빈예약 차량답변·인젝션 위생·빈응답 폴백)·`parseIntent` qa 2·`handleAssistantMessage` qa 2. functions 전체 379 그린, type-check 통과. Node 22. 커밋 `7e9aba8`. 프로덕션 **E2E 실증**(Socialprism): 차량 목록·이번주 예약자·범위 푸터 정상 |
| **후속** | "작년 12월 예약"류가 아직 `query`로 분류돼 범위 안내 대신 단일날짜 "예약 없음"을 반환(오답 아님) — 분류 경계 조이기. "마지막" 등록순 해석 옵션, 집계 코드 재검증, 창 크기 설정화, LLM 툴콜 기반 구조화 질의(수요 확인 후) |

### Phase 102: App Check Functions 2차 강제 — 예약·사용자/기관 관리 callable 🔐 (푸시 완료·CI 배포)

> 2026-07-19, 개선계획서 §1 App Check 단계 강제의 Functions 2차. 사용자가 콘솔에서 Authentication App Check 미검증률(24%)을 보고 "적용 가능?"을 물은 데서 출발해, **2차를 막던 게이트였던 "Authentication 미검증률 원인"(Phase 95에 보류 사유로 기록)을 규명**했다. 원인은 로그인 경로 `firebaseAuth.ts`가 번들 경량화로 **App Check를 일부러 미탑재** → 비로그인 사용자의 로그인 순간 요청이 구조적으로 "알 수 없는 출처"로 집계되는 것 + 18~19일 로컬 개발 트래픽 스파이크(디버그 토큰 미등록). 따라서 **Auth 레이어 강제는 보류가 맞고**(강제 시 로그인 차단), 실질 방어는 이미 강제 중인 Firestore·Storage로 충분하다는 결론 아래 Functions 2차만 진행.

| 항목 | 내용 |
|------|------|
| **대상** | 인증 앱에서만 호출되는 callable 6종 `enforceAppCheck: true` — `createReservationSafe`(예약 생성) + `disableUser`·`deleteUserPermanently`·`restoreUser`(사용자 관리) + `joinOrganization`·`withdrawOrganization`(기관 가입/해지) |
| **운행일지** | 전용 callable 없이 클라이언트가 Firestore에 직접 write → 이미 Firestore App Check 강제로 커버(추가 대상 없음) |
| **안전 논리** | 이 callable들은 로그인 후 `firebase.ts`(App Check 로드) 인스턴스에서 호출 → **이미 강제 중인 Firestore App Check를 99% 통과하는 동일 토큰**을 공유. 신규 차단 반경이 사실상 없음(Auth 로그인 경로와 상황이 근본적으로 다름) |
| **제외** | 3차: `askAI`·`ocrDocument`·`ocrDashboard`(남용 방어 가치 최대 → 별도 관찰 후). 공개 예외: `submitOrgApplication`·`submitPublicFeedback`(비로그인 진입·인앱 브라우저 비율, Zod+rate limit 방어). 알림/이메일/캘린더/Slack 콜러블은 후속 배치 후보 |
| **관찰 게이트** | 배포 후 2영업일: App Check invalid/expired <1%, callable `unauthenticated`/`permission-denied` 오류율 7일 평균 대비 +20% 미만. 특히 온보딩(`joinOrganization`)·예약(`createReservationSafe`) 실패 시 User-Agent 인앱 브라우저 여부 집계. 이상 시 해당 함수만 `false` 복원 단독 재배포(롤백 코스트 낮음) |
| **검증** | functions type-check·ESLint 0·jest 44 suites/416 통과, Node 22. 커밋 `5ad90cc` |
| **하지 않은 것** | Auth App Check 강제(로그인 경로 미탑재 → 강제 시 로그인 차단), 3차 askAI/OCR(다음 배치), 로그인 경로에 App Check 탑재(랜딩 번들·reCAPTCHA 부담 vs Rules/Functions 방어 충분으로 보류), 개발용 App Check 디버그 토큰 콘솔 등록(운영자 수동 작업으로 안내만) |
