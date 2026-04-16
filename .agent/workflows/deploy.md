---
description: 최신 내용 갱신, 커밋 및 차량운행일지 프로덕션 빌드 및 배포
---

> 📋 **배포 전 체크리스트**: 실행 전에 [agents.md §4 배포 시](../agents.md) 항목을 모두 확인한다.

// turbo-all

> ⚠️ **반드시 Node 22 LTS를 사용해야 합니다.** Node 24에서는 Rollup 스택 오버플로우가 발생합니다.

### --- [STEP 0: 프리-배포 문서화 과정] ---

1. Update Documentations 
   - **지시사항**: 에이전트는 본격적인 배포를 시작하기 전, 다음 항목들을 갱신해야 합니다.
     - **사용자 앱 내 알림 문서**: `업데이트 소식`, `자주 하는 질문`, `사용 설명서` (최근 작업 내역 반영)
     - **개발/프로젝트 문서**: `구현계획서.md`, `README.md` (가장 마지막 수정 이후의 개선사항 요약 반영)
   - 작업 내용을 모두 갱신한 후 다음 단계로 넘어갑니다.

2. Commit Changes
   - **지시사항**: 위 문서 갱신이 완료되면 모든 변경점을 스테이징하고 커밋합니다. (커밋 메시지가 필요할 경우 "chore: 배포 전 문서 갱신 및 릴리즈 준비" 사용을 권장)
```
git add . ; git commit -m "chore: 배포 전 문서 및 환경 갱신 완료"
```
Working directory: `.`

### --- [STEP 1: 프로덕션 빌드 및 배포] ---

3. Activate fnm + Switch to Node 22 LTS:
```
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; fnm use 22
```
Working directory: `.`

4. Verify Node version (반드시 v22.x 확인):
```
node --version
```
Working directory: `.`

> [!IMPORTANT]
> 프로덕션 빌드 시 Sentry 소스맵을 원활히 업로드하려면 환경변수(또는 `.env.local`)에 `SENTRY_AUTH_TOKEN`이 설정되어 있어야 합니다. (필요 시 확인)

5. Build for production:
```
npm run build
```
Working directory: `.`

6. Deploy Rules + Hosting:
```
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; fnm use 22; firebase deploy --only "firestore,storage,hosting"
```
Working directory: `.`
⚠️ exit code 1로 실패하면 최대 2회 재시도한다.

7. Deploy Functions:
```
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; fnm use 22; firebase deploy --only functions
```
Working directory: `.`
⚠️ exit code 1로 실패하면 최대 2회 재시도한다.
💡 `functions/` 디렉터리에 변경이 없으면 이 단계를 **건너뛴다**.
   - 판단 기준: `src/`, `public/`, 타입 정의 등 프론트엔드 코드만 변경된 경우 → 스킵
   - `functions/src/` 안의 파일이 변경된 경우 → 반드시 실행
