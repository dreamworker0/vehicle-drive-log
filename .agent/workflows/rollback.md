---
description: 프로덕션 배포 직후 치명적인 오류 발생 시 빠르게 이전 상태로 원복하기 위한 긴급 롤백 워크플로우
---

> 🚨 **주의**: 긴급 상황 발생 시 에러 원인 분석보다는 서비스 정상화(Rollback)가 최우선입니다. 이 워크플로우는 코드를 고치기 전 서버 상태를 즉각 되돌리기 위해 사용합니다.
>
> 이는 CLAUDE.md의 "긴급 시 로컬 실행" 예외 조항에 해당하는 **정당한 수동 작업**입니다(정상 배포는 master 푸시 → CI). 단, 롤백 직후 후속 커밋을 master에 푸시하면 CI가 다시 배포하므로, **로컬 롤백과 CI 재배포가 겹치지 않도록** 진행 중인 Deploy 워크플로 유무를 먼저 확인합니다(`gh run list --workflow=deploy.yml --limit 3`).

### --- [STEP 1: 상황 판단 및 프론트엔드 호스팅 롤백] ---

1. 호스팅 롤백이 필요한 경우 (UI 깨짐, 무한 리다이렉트 등 프론트엔드 오류)
   - **지시사항**: Firebase 호스팅은 CLI를 통해 즉각적인 이전 버전 롤백을 지원합니다.
```
firebase hosting:rollback
```
Working directory: `.`

### --- [STEP 2: Cloud Functions 이전 버전 복구 (필요시)] ---

Functions 배포 후 500 에러, App Check 관련 무한 에러 등 서버 로직 파탄 시:
2. Git을 활용한 코드 원복 (Revert)
   - **지시사항**: 로컬 저장소에서 문제가 발생한 배포 커밋을 `revert`합니다.
```
git revert HEAD --no-edit
```
Working directory: `.`

3. Functions 재배포
   - **지시사항**: 이전 코드로 되돌려진 Functions를 다시 배포합니다.
```
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; fnm use 22; cd functions; npm run build; cd ..; firebase deploy --only functions
```
Working directory: `.`

### --- [STEP 3: Firestore/Storage Rules 복구 (필요시)] ---

보안 규칙 변경으로 인해 정상 사용자가 데이터를 읽지 못하는 권한 에러(permission-denied) 급증 시:
4. Rules 복구 및 배포
   - **지시사항**: 만약 보안 규칙만 문제라면 `firestore.rules`, `storage.rules`를 git에서 이전 버전으로 복구(`git checkout HEAD^ -- firestore.rules`)한 후 아래 명령을 실행합니다.
```
firebase deploy --only "firestore:rules,storage"
```
Working directory: `.`

### --- [STEP 4: 정상화 확인] ---

5. **지시사항**: 배포 롤백이 완료된 후, 주요 기능(로그인, 대시보드 진입, 차량 목록 조회)이 정상 작동하는지 수동으로 확인하도록 사용자에게 요청합니다. 이후 오류 원인 분석으로 넘어갑니다.
