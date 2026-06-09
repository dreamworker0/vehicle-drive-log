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

### --- [STEP 1: 사전 빌드 검증 및 Node 22 환경 강제] ---

배포를 빌드하기 전, 코드의 무결성과 Node.js 버전 호환성을 완벽히 확인해야 합니다.

3. Node 22 LTS 버전 강제 검증:
   * **지시사항**: 아래 한 줄 스크립트를 실행하여 현재 Node.js 버전이 22.x 대인지 엄격히 검증합니다. v22가 아닐 경우 즉시 배포 프로세스를 중단하고 `fnm use 22`를 사용하여 환경을 전환합니다.
```powershell
node -e "if(!process.version.startsWith('v22.')) { console.error('❌ 에러: Node 22 LTS 버전이 필요합니다. 현재 버전: ' + process.version); process.exit(1); }"
```
Working directory: `.`

4. 전체 사전 검증 실행 (TypeScript / Lint / Test):
   * **지시사항**: 빌드 전에 타입 검사와 린터, 단위 테스트를 무조건 통과해야 배포할 수 있습니다.
```powershell
npm run type-check && npm run lint && npm test run
```
Working directory: `.`

### --- [STEP 2: 프로덕션 빌드 및 배포] ---

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

7. Build and Deploy Functions:
```
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; fnm use 22; cd functions; npm run build; cd ..; firebase deploy --only functions
```
Working directory: `.`
⚠️ exit code 1로 실패하면 최대 2회 재시도한다.
💡 `functions/` 디렉터리에 변경이 없으면 이 단계를 **건너뜬다**.
   - 판단 기준: `src/`, `public/`, `package.json`(루트) 등 프론트엔드 코드만 변경된 경우 → 스킵
   - `functions/src/`, `functions/package.json` 등 백엔드 로직이 변경된 경우 → 반드시 실행
