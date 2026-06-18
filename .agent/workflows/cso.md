---
description: 공격자 관점 주기적 보안 감사 — 멀티테넌트 격리·Secrets·LLM/Gemini·스킬 공급망을 확신도 게이트로 점검하고 확정 발견을 정적 규칙·테스트로 환류한다
---

# /cso — 차량운행일지 보안 감사

> **철학**: "공격자처럼 생각하고, 방어자처럼 보고한다." 누락 0보다 **노이즈 0**을 우선한다.
> 검증된 발견 3건이, 진짜 3건 + 이론적 12건보다 낫다. 현실적 익스플로잇 경로 없는 이론적 위험은 보고하지 않는다.
>
> 이 워크플로우는 셸 스크립트가 아니라 **에이전트 분석 절차**다. 각 Phase의 지시대로 코드·설정을 읽고(Read/Grep/Glob), 추론하고, 확신도 게이트를 통과한 발견만 보고한다.
> gstack `/cso`를 이 프로젝트(Firebase 멀티테넌트 PWA + Gemini OCR + `.agent` 하네스)에 맞춰 5-phase로 트림한 버전이다.

## 모드

| 모드 | 게이트 | 용도 |
|---|---|---|
| `/cso` (기본) | 8/10 이상만 보고 | 일상 감사, 노이즈 0 |
| `/cso --comprehensive` | 2/10까지 부록에 기재 | 분기별 심층, 잠정 발견 포함 |
| `/cso --diff` | (위와 결합) 현재 브랜치 변경 파일만 | PR 전 빠른 점검 |

상호 배타 플래그가 충돌하면 즉시 에러로 중단한다(임의 선택 금지).

## Phase 0–1 — 공격면 census (항상 실행)

취약점 스캔 전에 공격면을 먼저 지도화한다:
- **Functions 엔드포인트**: [functions/src/index.ts](../../functions/src/index.ts)의 export — callable / HTTP / Firestore 트리거 / 스케줄. 각 진입점의 인증·권한 경계.
- **데이터 경계**: [src/lib/firestore/](../../src/lib/firestore/) 도메인 파일, [firestore.rules](../../firestore.rules), [storage.rules](../../storage.rules), [firestore.indexes.json](../../firestore.indexes.json).
- **외부 통합**: Gemini OCR, Google Calendar OAuth, FCM, 알림톡/이메일 발신, Discord 웹훅(functions Sentry).
- **시크릿 표면**: `.env`/`.env.local`, `.firebaserc`, [firebase.json](../../firebase.json), 서비스계정, CI 시크릿.

산출: 진입점·경계 목록(다음 Phase의 스캔 대상).

## Phase A — Secrets

- `.env`/`.env.local`이 추적·노출되지 않는지(절대규칙 #5). `git log`/`git grep`으로 **히스토리에 커밋된 적 있는지** 확인.
- 하드코딩된 Gemini 키·OAuth 시크릿·서비스계정·Discord 웹훅 URL (소스·스크립트·CI yaml).
- **검증**: 키 형식(prefix·길이)으로만 확인하고 **실제 API로 테스트하지 않는다.**
- 유출 확정 시 대응 플레이북 포함: 폐기 → 재발급 → 히스토리 스크럽 → 노출 기간 감사 → 공급자 로그 확인.

## Phase B — OWASP A01 멀티테넌트·Rules 격리 (최우선) ⭐

이 앱의 최대 급소. 클라이언트 쿼리의 `organizationId` 누락은 이미 [eslint-rules/require-organization-filter.js](../../eslint-rules/require-organization-filter.js)가 정적으로 막으므로, **cso는 그 너머의 서버 경계**에 집중한다:
- [firestore.rules](../../firestore.rules): 조직 격리(`isOrgMember`/`belongsToMyOrg` 등 헬퍼)가 **모든 tenant-scoped 컬렉션**에 적용되는지. 누락·우회 경로.
- 역할 경계(superAdmin/admin/employee) — [role-based-access §](../rules/role-based-access.md). 프론트 UI 가림만으로 권한 제어하는 곳이 있는지(D11), 백엔드 재검증 여부.
- Functions의 callable/HTTP가 `context.auth`와 조직·역할을 **반드시 재검증**하는지.
- Storage 규칙이 조직·소유자 단위로 격리되는지.

## Phase C — LLM / Gemini OCR ⭐

- **프롬프트 인젝션**: 사용자가 업로드한 계기판 이미지·증빙 서류가 시스템 프롬프트 구성에 어떻게 흘러가는지 추적. OCR 결과를 신뢰 경계 없이 다음 프롬프트/명령에 주입하는 곳.
- **출력 무검증 렌더링**: OCR 결과 텍스트를 이스케이프 없이 렌더링/저장하는 경로.
- **비용 증폭(DoS 제외의 예외)**: 악의적 사용자가 대용량·다수 이미지로 Gemini 호출을 폭증시킬 수 있는지 — 호출 횟수·크기·인증 제한. [ocr-cost-security §](../rules/ocr-cost-security.md) 기준 대비 실제 코드 점검.

## Phase D — 스킬 공급망 (하네스 자기 감사)

`.agent/skills`·`.agent/workflows`는 `.claude/`로 동기화되어 **자동 실행되는 프롬프트 코드**다(거짓양성 제외 #15의 예외 — 보안 문서가 아니라 실행 코드로 취급).
- SKILL.md/워크플로우에 데이터 탈취·인젝션·임의 명령 유도 패턴이 있는지.
- [scripts/sync-claude-agents.ts](../../scripts/sync-claude-agents.ts)의 마커 기반 삭제·생성 로직이 신뢰 경계를 넘는 파일을 쓰지 않는지.

## 의존성 (Phase 3 위임)

**중복 구현 금지.** `npm run audit`([scripts/security-audit.ts](../../scripts/security-audit.ts), root+functions)를 호출하고 그 결과만 요약 인용한다. CVSS 4.0 미만·알려진 익스플로잇 없는 CVE는 보고하지 않는다.

## 확신도 게이트

| 점수 | 의미 | 기본 게이트 | --comprehensive |
|---|---|---|---|
| 9–10 | 검증된 익스플로잇 | 보고 | 보고 |
| 7–8 | 고확신 패턴 | 보고 | 보고 |
| 5–6 | 중간 확신 | 단서와 함께 보고 | 보고 |
| 3–4 | 저확신 | 억제 | 부록만 |
| 1–2 | 추측 | 억제(P0 제외) | 억제 |

## 검증 게이트 (보고 전 필수)

- **인용 강제**: 발견을 유발한 `파일:줄` + 원문 코드를 반드시 인용. 인용 못 하면 확신도 4–5로 강등하고 부록으로.
- Firestore Zod 컨버터·Rules 헬퍼 등 메타 구조는 본문 대신 해당 메타 구문에서 인용 가능.
- 능동 검증: Secrets=형식만, 웹훅=서명 검증 체인 추적, 권한=`context.auth`→조직/역할 도달 확인, 의존성=취약 함수 직접 호출 여부, LLM=데이터 흐름이 프롬프트 구성까지 도달하는지.
- 상태 표기: `VERIFIED` / `UNVERIFIED` / `TENTATIVE`(comprehensive 전용).

## 거짓양성 제외 (이 프로젝트 맞춤)

다음은 익스플로잇 증명 없이는 보고하지 않는다:
1. DoS/자원 고갈 — **단, Gemini 비용 증폭은 예외(보고)**
2. 적절한 권한의 디스크 암호화 시크릿
3. 비핵심 필드 입력검증 누락(익스플로잇 증명 없을 때)
4. GitHub Actions 이슈 — 미고정 액션·`pull_request_target`은 예외(보고)
5. 경합 조건(구체적 익스플로잇 경로 없을 때)
6. 의존성 CVE(Phase 3가 처리), CVSS 4.0 미만
7. 테스트 전용·미import 코드
8. 로그 스푸핑, 감사 로그 부재
9. 비보안 맥락의 약한 난수
10. 같은 PR에서 커밋·제거된 시크릿
11. `.dev`/`.local` 전용 설정 이슈
- **예외 #15**: SKILL.md/워크플로우는 실행 프롬프트 코드 → 보안 문서 제외에 해당하지 않음(Phase D에서 점검).

## 발견 보고 형식

각 발견마다:
- **익스플로잇 시나리오**(필수): 단계별 공격 경로. 없으면 보고 불가.
- **심각도**: CRITICAL / HIGH / MEDIUM
- **확신도**: 1–10 + 근거
- **상태**: VERIFIED / UNVERIFIED / TENTATIVE
- **카테고리**: Secrets / 멀티테넌트(A01) / LLM / 스킬공급망 / 통합 / CI/CD / 의존성

## 변종 분석

확정된 발견 1건마다 Grep으로 코드 전체에서 **동일 패턴**을 색출해 변종으로 함께 보고한다(원 발견에 연결).

## 출력

`docs/security-reports/YYYY-MM-DD.md`로 저장(오늘 날짜). 머리말에 필터 통계(검토 N건 → 억제 M건 → 보고 K건)와 직전 리포트 대비 변화 요약.

## 강제 환류 루프 (이 프로젝트의 핵심)

리포트로 끝내지 않는다. 확정(VERIFIED) 발견은 이 repo의 자동 강제 체계로 환류시킨다 — **사용자 승인 후** 진행:
- **멀티테넌트(A01) 발견** → 가능하면 [eslint-rules/](../../eslint-rules/) 커스텀 규칙(organizationId 강제처럼) 또는 `tests/firestore-rules.test.ts`(`npm run test:rules`) 케이스로 영구 강제.
- **Gemini 비용/인젝션 발견** → [ocr-cost-security.md](../rules/ocr-cost-security.md) 규칙 강화.
- **CI/CD 발견** → [ci-cd.md](../rules/ci-cd.md) + 해당 워크플로 수정.
- 즉 **cso(탐지) → 정적 규칙·테스트(강제)** 파이프라인을 닫는다.

> 참고: `firebase deploy`·시크릿 폐기 등 외부 영향·되돌리기 어려운 조치는 보고만 하고 **반드시 사용자 확인 후** 실행한다.
