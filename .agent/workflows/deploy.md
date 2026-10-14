---
description: 문서 갱신·검증 후 PR을 머지해 CI 배포를 트리거한다 (master 직접 푸시·로컬 직접 배포 금지)
---

> 📋 **배포 전 체크리스트**: 실행 전에 [agents.md §4 배포 시](../agents.md) 항목을 모두 확인한다.
>
> 🚫 **배포 단일 경로**: 프로덕션 배포는 **PR 머지(= master 푸시) → GitHub Actions Deploy 워크플로**([.github/workflows/deploy.yml](../../.github/workflows/deploy.yml))가 수행한다.
> 로컬 `firebase deploy`를 병행하면 동일 함수 동시 업데이트 충돌이 발생하므로 **로컬에서 직접 배포하지 않는다.**
> 긴급 수동 부분배포가 꼭 필요하면 [deploy-emergency](deploy-emergency.md)의 **긴급 가드** 절차를 따른다.

// turbo-all

### --- [STEP 0: 프리-배포 문서화 과정] ---

1. Update Documentations
   - **지시사항**: 본격적인 배포를 시작하기 전, 다음 항목들을 갱신한다.
     - **사용자 앱 내 알림 문서**: `업데이트 소식`, `자주 하는 질문`, `사용 설명서` (최근 작업 내역 반영)
     - **개발/프로젝트 문서**: `구현계획서.md`, `README.md` (마지막 수정 이후의 개선사항 요약 반영)
   - 작업 내용을 모두 갱신한 후 다음 단계로 넘어간다.

1-1. 업데이트 소식 누락 확인 (기계 판정):
   - 사용자 화면이 달라진 변경이 공지 없이 배포되는 것을 막는다. 후보가 나오면
     [release-notes 스킬](../skills/release-notes/SKILL.md)의 규칙대로 `public/data/releaseNotes.json`에
     항목을 추가하고 다시 실행한다. 알릴 내용이 아닌 변경이면 `-- --soft`로 확인만 하고 넘어간다.
```powershell
npm run check:release-notes
```
Working directory: `.`

1-2. FAQ 누락 확인 — 공지의 새 기능 항목(`type: "new"`)에 FAQ id가 연결됐는지 본다. 필요 없다고 판단했으면 `"faq": []`로 넘긴다. 끊긴 연결(없는 id)은 `--soft`로도 통과하지 않는다:
```powershell
npm run check:faq
```
Working directory: `.`

1-3. 수동 점검 — 기계가 보지 못하는 것:
   - **Firestore 인덱스**: 새 복합 쿼리(`where + orderBy` 등)가 추가됐다면 `firestore.indexes.json`에 있는지 확인한다 (`git diff master -- src/lib/firestore/ functions/src/`). 인덱스 누락은 운영에서만 터진다.
   - **환경 변수**: 새 `VITE_*`가 `.env.local.example`에, 새 Functions `process.env.*`가 Functions 환경변수에 반영됐는지 확인한다.

> **자주 놓치는 것**
> - **Functions index.ts export 누락** — 새 함수를 `functions/src/index.ts`에서 export하지 않으면 배포돼도 호출 불가.
> - **firestore.rules 변경 후 룰 테스트 누락** — CI(`ci.yml`의 Security Rules tests)가 PR마다 돌리지만, 규칙을 고쳤다면 `npm run test:rules`로 로컬에서도 먼저 확인한다.
> - **PWA 캐시 무효화** — 서비스워커(`src/sw.ts`, 빌드 시 dist/sw.js로 생성)나 `index.html` cache-control 변경 없이 배포 시 구버전이 잔존. 최근 커밋(`14d59ac`)에서도 발생한 패턴.
> - **App Check 토큰 디버그 모드** — `b295455` 커밋처럼 프로덕션에 debug token이 새지 않는지 빌드 산출물 grep.
> - **업데이트 소식 누락** — 배포는 됐는데 공지가 그대로인 일이 반복된다(Phase 143~145에서 다섯 건). `npm run check:release-notes`가 기계로 잡아 주므로 반드시 돌린다.
> - **FAQ 누락** — 공지는 나갔는데 FAQ에 없는 일이 반복된다. 출발지·분관 기능은 공지가 네 번 나가는 동안 FAQ 항목이 하나도 없었다(2026-09-06 발견). `npm run check:faq`가 새 기능 공지의 FAQ 연결이 비었는지 잡아 준다 — 필요 여부는 사람이 판단하되(`"faq": []`로 넘길 수 있다), 판단을 건너뛰는 것은 막는다.

### --- [STEP 1: 사전 검증 (Node 22 + 정적 검사 + 빌드)] ---

> ⚠️ **반드시 Node 22 LTS.** Node 24에서는 Rollup 스택 오버플로우가 발생한다.
> CI도 Node 22로 빌드하므로, 로컬에서 동일 조건으로 미리 통과시켜 CI 실패를 예방한다.

2. Node 22 LTS 버전 강제 검증:
```powershell
npm run check:node -- --strict
```
Working directory: `.`

3. 전체 사전 검증 실행 (TypeScript / Lint / Test):
   - ⚠️ PowerShell 5.1은 `&&` 체이닝을 지원하지 않는다. npm 스크립트 하나로 묶은 `verify:fast` + 전체 단위 테스트를 순서대로 실행하고, **앞 명령이 실패하면 중단**한다.
```powershell
npm run verify:fast
```
```powershell
npm test
```
Working directory: `.`

4. 프로덕션 빌드로 번들 크기·빌드 무결성 확인 (CI가 다시 빌드하지만 로컬에서 선검증):
```powershell
npm run build
```
Working directory: `.`

### --- [STEP 2: 브랜치 → PR → 머지 (CI 배포 트리거)] ---

> ⚠️ **master에 직접 푸시하지 않는다 — 거부된다.** master는 보호 브랜치다(필수 PR · 필수 체크 `ci`·`e2e`·
> `functions-tests`·`security-audit` · `enforce_admins: true`). 예전 이 단계는 `git push origin master`를 지시했지만
> 실제 경로는 PR squash 머지뿐이다(2026-10-14 감사에서 정정).

5. 브랜치에 커밋하고 PR을 연다:
   - 커밋 메시지는 한국어 Conventional Commits([commit-message](../rules/commit-message.md)).
   - 문서(`docs/**`·`**.md`)만 바뀐 PR은 CI가 건너뛰어지고 **머지해도 배포가 일어나지 않는다** — 배포를 기다리지 말 것([ci-cd 규칙 §1.2](../rules/ci-cd.md)).
```powershell
git switch -c <type>/<짧은-설명> ; git add <파일들> ; git commit -m "<type>: <한국어 요약>" ; git push -u origin HEAD ; gh pr create --base master --fill
```
Working directory: `.`

6. CI가 전부 초록이고 미해결 리뷰 지적이 없으면 squash 머지한다(GitHub auto-merge는 저장소 설정상 쓸 수 없다):
```powershell
gh pr checks <PR번호> ; gh pr merge <PR번호> --squash
```
Working directory: `.`

> ⚠️ **머지는 한 건씩 — 앞 머지의 Deploy 성공을 확인한 뒤 다음 PR을 머지한다.** 머지마다 Deploy가 함수 전체를
> 갱신하는데, 연달아 돌면 Cloud Functions API 한도(`Quota Exceeded`)에 걸려 일부 함수가 실패하고 **Hosting 단계가
> 실행되지 않는다**(2026-10-01 실제 발생, Phase 235). 자세한 규칙은 [ci-cd §2.4](../rules/ci-cd.md).

### --- [STEP 3: CI 배포 모니터링] ---

7. GitHub Actions 배포 상태 추적:
   - **지시사항**: 머지 커밋의 master CI → Deploy 워크플로를 추적한다. 실패하면 로그를 확인하고 원인을 보고한다 (로컬에서 임의로 `firebase deploy`를 실행해 우회하지 않는다).
   - **성공 판정은 로그로 한다**: `failed to update function`이 재시도 뒤 `Successful update operation`이 됐는지(함수 수만큼), Hosting `release complete`가 찍혔는지. `Quota Exceeded`로 일부 함수가 끝내 실패했으면 로컬 배포 대신 `gh run rerun <run-id> --failed`로 Deploy를 다시 돌린다.
```powershell
gh run watch --exit-status
```
Working directory: `.`
💡 `gh`가 없으면 GitHub 저장소 → Actions 탭 → "Deploy" 워크플로에서 직접 확인하도록 사용자에게 안내한다.
⚠️ CI가 실패하면 로그를 첨부해 보고하고, 코드 수정이 필요하면 STEP 1부터 다시 수행한다.
