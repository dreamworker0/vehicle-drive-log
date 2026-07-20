---
description: 문서 갱신·검증·커밋 후 master 푸시로 CI 배포를 트리거한다 (로컬 직접 배포 금지)
---

> 📋 **배포 전 체크리스트**: 실행 전에 [agents.md §4 배포 시](../agents.md) 항목을 모두 확인한다.
>
> 🚫 **배포 단일 경로**: 프로덕션 배포는 **master 푸시 → GitHub Actions Deploy 워크플로**([.github/workflows/deploy.yml](../../.github/workflows/deploy.yml))가 수행한다.
> 로컬 `firebase deploy`를 병행하면 동일 함수 동시 업데이트 충돌이 발생하므로 **로컬에서 직접 배포하지 않는다.**
> 긴급 수동 부분배포가 꼭 필요하면 [deploy-hosting](deploy-hosting.md) / [deploy-functions](deploy-functions.md) / [deploy-rules](deploy-rules.md)의 **긴급 가드** 절차를 따른다.

// turbo-all

### --- [STEP 0: 프리-배포 문서화 과정] ---

1. Update Documentations
   - **지시사항**: 본격적인 배포를 시작하기 전, 다음 항목들을 갱신한다.
     - **사용자 앱 내 알림 문서**: `업데이트 소식`, `자주 하는 질문`, `사용 설명서` (최근 작업 내역 반영)
     - **개발/프로젝트 문서**: `구현계획서.md`, `README.md` (마지막 수정 이후의 개선사항 요약 반영)
   - 작업 내용을 모두 갱신한 후 다음 단계로 넘어간다.

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

### --- [STEP 2: 커밋 & 푸시 → CI 배포 트리거] ---

5. Commit & Push:
   - **지시사항**: 모든 변경점을 스테이징·커밋한 뒤 master로 푸시한다. 푸시 즉시 Deploy 워크플로가 트리거된다.
```powershell
git add . ; git commit -m "chore: 배포 전 문서 및 환경 갱신 완료" ; git push origin master
```
Working directory: `.`

### --- [STEP 3: CI 배포 모니터링] ---

6. GitHub Actions 배포 상태 추적:
   - **지시사항**: 트리거된 Deploy 워크플로의 진행 상황을 추적한다. 실패하면 로그를 확인하고 원인을 보고한다 (로컬에서 임의로 `firebase deploy`를 실행해 우회하지 않는다).
```powershell
gh run watch --exit-status
```
Working directory: `.`
💡 `gh`가 없으면 GitHub 저장소 → Actions 탭 → "Deploy" 워크플로에서 직접 확인하도록 사용자에게 안내한다.
⚠️ CI가 실패하면 로그를 첨부해 보고하고, 코드 수정이 필요하면 STEP 1부터 다시 수행한다.
