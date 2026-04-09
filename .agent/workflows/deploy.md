---
description: 최신 내용 갱신, 커밋 및 차량운행일지 프로덕션 빌드 및 배포
---

> 🛑 **배포 전 필수 사전 작업** (Turbo 실행 전 에이전트가 직접 챙겨서 수행할 것)
1. **사전 문서 갱신 점검 및 수정**
   - 사용자에게 이번 배포에 포함된 '업데이트 소식'이나 'FAQ 변경 사항'이 있는지 묻거나, 지금까지의 맥락을 파악해 반영한다 (`src/lib/faqData.ts` 등).
   - 수행한 작업 내용을 바탕으로 `구현계획서.md` 문서의 체크리스트 및 히스토리를 최신 상태로 갱신한다.
2. **Git 스테이징 및 커밋**
   - 변경된 사항들에 대해 터미널에서 `git add .`을 실행한다.
   - 수행한 내용들을 요약하여 의미 있는 커밋 메시지로 `git commit -m "커밋 명"` 명령을 실행한다.
3. **GitHub으로 원격 백업 (Push)**
   - 커밋 직후 터미널에서 `git push` 명령을 실행하여 변경된 코드를 원격 저장소에 안전하게 백업한다.

// turbo-all

> ⚠️ **반드시 Node 22 LTS를 사용해야 합니다.** Node 24에서는 Rollup 스택 오버플로우가 발생합니다.

1. Activate fnm + Switch to Node 22 LTS:
```
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; fnm use 22
```
Working directory: `.`

2. Verify Node version (반드시 v22.x 확인):
```
node --version
```
Working directory: `.`

3. Build for production:
```
npm run build
```
Working directory: `.`

4. Deploy Rules + Hosting:
```
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; fnm use 22; firebase deploy --only "firestore,storage,hosting"
```
Working directory: `.`
⚠️ exit code 1로 실패하면 최대 2회 재시도한다.

5. Deploy Functions:
```
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; fnm use 22; firebase deploy --only functions
```
Working directory: `.`
⚠️ exit code 1로 실패하면 최대 2회 재시도한다.
💡 `functions/` 디렉터리에 변경이 없으면 이 단계를 **건너뛴다**.
   - 판단 기준: `src/`, `public/`, 타입 정의 등 프론트엔드 코드만 변경된 경우 → 스킵
   - `functions/src/` 안의 파일이 변경된 경우 → 반드시 실행
