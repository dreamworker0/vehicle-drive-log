# 2026-07 공개 전환 후 보안 재검증 보고서

- 재검증일: 2026-07-18
- 계기: `master` 저장소 public 전환 직후 외부 보안 점검 발견 사항의 독립 재확인
- 기준: 현재 `master` 코드 + GitHub 설정 실측
- 원칙: 원 감사 라벨과 별개로 **실질 악용 가능성 기반 심각도**를 독립 부여. 코드 미수정(검증 전용).
- 관련 문서: [2026-07-audit-featureflags.md](2026-07-audit-featureflags.md)

## 종합 표

| # | 발견 | 사실 재검증 | 실질 악용 가능성 | 재검증 심각도 | 원 라벨 |
|---|---|---|---|---|---|
| 1 | F-01/F-02 driverUid·vehicle 미검증 | CONFIRMED | 인증된 내부자가 raw SDK로 자기 기관 내 오지정. 교차테넌트 유출 아님 | **MED** | HIGH |
| 2 | master 보호·Actions 설정 부족 | CONFIRMED | 배포는 이미 CI성공 게이트有. 핵심은 Actions 공급망(prod secrets) | **MED** | — |
| 3 | Dependabot/CodeQL/PVR 비활성 + 문서 불일치 | CONFIRMED | 취약 의존성 무경보 + SECURITY.md가 죽은 채널 안내 | **MED** | — |
| 4 | Functions 19개 App Check 미강제 | CONFIRMED | 미인증 공개+Gemini 고비용 경로가 실질 위험 | **MED–HIGH**(경로별) | — |
| 5 | security-audit.ts fail-open | CONFIRMED(부분) | audit 네트워크 오류를 0건으로 오판. 현재 실제 0건이라 미노출 | **LOW–MED** | — |
| 6 | Secret Scanning 알림 #1 (웹 API 키) | CONFIRMED / 비-비밀 | Firebase 공개 설계값. GCP 제한 이미 적용됨 | **INFO** | — |
| 7a | submitOrgApplication 영구 다운로드 토큰 | CONFIRMED | 민감서류에 만료 없는 bearer URL, 미인증 호출자에 반환 | **HIGH** | — |
| 7b | sendAdminNotice employee 허용 | REFUTED(보안버그 아님) | 인증·기관격리 정상. 정책 결정 사안 | **LOW** | — |

## 발견별 상세

### 1. F-01/F-02 (driverUid·차량 미검증) — CONFIRMED, 심각도 하향(HIGH→MED)

- `firestore.rules:155-159` create는 `createdByUid == request.auth.uid`만 강제, driverUid 존재/기관/활성·vehicleId 문서 미검증. update(160-171)도 driverUid·vehicleId를 소유자가 변경 가능(불변 집합 `organizationId,vehicleId,createdByUid`에 driverUid 없음).
- 그러나 `newBelongsToMyOrg()`가 로그 `organizationId`를 호출자 기관에 고정 → 교차 테넌트 유출 아님. 악용엔 인증된 자기 기관 멤버의 raw SDK 조작 필요, 피해는 자기 기관 통계/참조 오지정.
- 위험 수용은 소규모 기관 맥락에서 방어 가능. 단 공개 전환으로 rules 노출 → 발견 문턱 하락.
- **저비용 보완책:** 기존 `monthlyBatch`(주행거리 정합성 검증)에 driverUid/vehicleId 유효성 배치 검사를 얹으면 get()-per-write 없이 사후 탐지 가능. 우선순위 낮음(P2).

### 7a. submitOrgApplication 영구 토큰 — CONFIRMED, HIGH (신규 최우선급)

- `functions/src/handlers/https/submitOrgApplication.ts:110-146`: uuid 토큰 생성 → `firebaseStorageDownloadTokens` 메타 심음 → 토큰 포함 URL을 Firestore org 문서(`uniqueNumberImageUrl`)에 저장 + 미인증 호출자에 응답 반환.
- 다운로드 토큰 URL은 Storage 규칙을 우회하는 만료 없는 bearer capability. 사업자등록증·고유번호증 등 민감서류가 URL 유출(로그·문서·응답 캡처) 시 무인증 다운로드됨.
- 이번 재검증에서 가장 실질적인 신규 위험(런타임 기밀성). 공개 여부와 무관. **P0 코드 수정 대상.**
- 대안: 토큰 미생성 + Storage 규칙으로 admin/superAdmin만 읽기, 심사 시 `getSignedUrl({짧은 만료})` 온디맨드 발급, Firestore엔 경로만 저장, 심사 후 lifecycle 삭제.

### 4. App Check 미강제 — CONFIRMED, 경로별 차등

19개 중 실질 위험은 소수 집중. 나머지는 인증+역할 게이트 견고 → App Check는 심층방어.

- **그룹1 (P1, 높음):** `submitOrgApplication`·`submitPublicFeedback`(둘 다 미인증 공개 onCall, 방어가 이메일/IP rate limit뿐 — 회전 우회 가능, 캡차 없음), `ocrDashboard`·`ocrDocument`·`askAI`(Gemini 비용 표면, 로그인만 요구). rate limit은 fail-closed 설계 양호하나 앱 출처 강제(App Check)가 빠진 유일한 방어선.
- **그룹2 (P2, 중간·심층방어):** `triggerOnDemandCalendarSync`(빈발+per-user rate limit 부재), `withdrawOrganization`(재앙적, rate limit 부재), `deleteUserPermanently`·`disableUser`(파괴적, 게이트 견고), `sendAdminNotice`.
- **그룹3 (선택):** superAdmin 전용 6종(`restoreUser`, 이메일/알림톡 발송류), `createReservationSafe`·`joinOrganization`·`testCalendarAccess`.
- 기존 로드맵(Functions App Check 순차 강제)과 일치. 그룹1부터.

### 2. master 보호·Actions — CONFIRMED, 뉘앙스 있음

- 실측: 보호 객체 존재하나 필수 상태체크·필수 리뷰 없음, `enforce_admins=false`, `required_conversation_resolution=false`. Actions `allowed_actions=all`, `sha_pinning_required=false`. (기본 워크플로 토큰은 `read` — 양호)
- 뉘앙스: `deploy.yml`은 `workflow_run`으로 CI 성공 시에만 배포 → "깨진 코드 자동배포"는 이미 사실상 차단. 브랜치 보호 required-checks는 push/merge 차단용이라 배포 게이트와 별개.
- 실질 핵심은 Actions 공급망: `deploy.yml`이 프로덕션 secrets를 쥐는데 액션이 태그(`@v5`)로 고정 → 태그 이동·서드파티 액션 침해 시 secrets 노출 위험. 서드파티 액션 SHA 핀 + `allowed_actions` 제한 권장(P1).

### 3. GitHub 보안 기능 — CONFIRMED → **2026-07-18 일부 조치 완료**

- 재검증 시점: Dependabot 취약점 알림 OFF, 보안 업데이트 OFF, CodeQL 없음, Private vulnerability reporting OFF.
- 문서 불일치: `SECURITY.md`·이슈 템플릿이 "Security Advisory 비공개 제보"를 안내하나 PVR이 꺼져 링크 무동작.
- **조치(2026-07-18):** Private vulnerability reporting ON, Dependabot 취약점 알림 ON, Dependabot 보안 업데이트 ON. → SECURITY.md와 정합 완료. **CodeQL은 미도입(P2 잔여).**

### 5. security-audit.ts fail-open — CONFIRMED(부분)

- `scripts/security-audit.ts` `runAudit` catch 경로(69-96)가 npm audit 네트워크 오류 JSON(`{error:{...}}`)을 정상 파싱 → `vulnerabilities` 없음 → `|| {}` → 0건 통과. `JSON.parse` throw 시에만 fail-closed. `auditReportVersion`·`metadata.vulnerabilities`·`error` 미검증.
- 현재 실제 audit는 루트·functions 양쪽 0건이라 활성 노출 없음.
- 수정(저비용): "정상 리포트 형태(auditReportVersion 존재 + metadata.vulnerabilities 객체) 아니면 null 반환→exit 1"로 뒤집기. 카운트도 `metadata.vulnerabilities` 우선. (P1)

### 6. Secret Scanning 알림 #1 — CONFIRMED이나 비-비밀

- `google_api_key`(Firebase 웹 키, `public/firebase-messaging-sw.js`). 클라이언트 번들에 실리는 공개 설계값. GCP에서 HTTP 리퍼러 + API 제한 이미 적용.
- 조치: 키 교체 금지(앱 파손). **알림을 false-positive/won't-fix로 종결** + 제한 유지. 선택: sw.js 커밋값을 placeholder로 바꾸고 빌드 주입에 위임하면 스캐너 노이즈 제거(기능상 불필요).

### 7b. sendAdminNotice — REFUTED(보안버그 아님)

- 인증·`organizationId` 일치·수신자 팬아웃 전부 자기 기관 스코프 → 교차 기관 발송 불가.
- 역할 화이트리스트(`sendAdminNotice.ts:35`)에 `employee` 포함 → 직원도 기관 전체 공지 가능. 인증 우회가 아니라 "공지가 관리자 전용이어야 하는가" 정책 결정. 관리자 전용이 요구면 `employee` 제거로 강제.

## 권장 수정 순서

**P0 — 즉시**
1. ~~Private vulnerability reporting 켜기~~ → **완료(2026-07-18)**
2. ~~Dependabot 알림 + 보안 업데이트 켜기~~ → **완료(2026-07-18)**
3. submitOrgApplication 영구 토큰 제거(7a) — 유일한 실질 기밀성 노출. 서명 URL/경로 저장으로 전환

**P1 — 곧**
4. App Check 그룹1 재강제 — submitOrgApplication·submitPublicFeedback·ocrDashboard·ocrDocument·askAI
5. Actions 공급망: 서드파티 액션 SHA 핀 + allowed_actions 제한
6. security-audit.ts fail-closed 수정(5)

**P2 — 여력 될 때**
7. 브랜치 보호: 최소 CI required check + enforce_admins
8. App Check 그룹2(파괴적/빈발)
9. sendAdminNotice 정책 결정(7b)
10. Secret Scanning 알림 #6 종결 처리
11. CodeQL 워크플로 추가(공개=무료)
12. F-01/F-02 보완: monthlyBatch에 정합성 배치 검사(위험 수용 유지)

## 재검증에서 확인한 잘된 부분

- `.env`, `functions/.env`, 서비스계정 JSON, PEM/KEY는 Git 무시. 434개 커밋에서 서버용 비밀키 미발견.
- Secret Scanning + Push Protection 활성.
- Actions 기본 GITHUB_TOKEN 권한 `read`.
- npm audit 현재 루트·functions 양쪽 0건.
- rate limit fail-mode 설계 양호(고비용/공개 경로 fail-closed, OCR 분+일일 이중 쿼터).
- Firestore 멀티테넌트 격리: 로그·예약·알림·발송 팬아웃 모두 `organizationId` 스코프 유지(교차 테넌트 유출 경로 미발견).
