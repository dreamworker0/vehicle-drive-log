---
description: 문서 갱신, Git 스테이징, 커밋, 푸시를 한번에 실행
---
// turbo-all

### --- [STEP 0: 프리-커밋 문서 갱신 과정] ---

1. Update Documentations 
   - **지시사항**: 에이전트는 본격적인 코드 검증 및 커밋을 시작하기 전, 이번 작업 내역을 바탕으로 다음 항목들을 갱신해야 합니다.
     - **사용자 앱 내 알림 문서**: `업데이트 소식`, `자주 하는 질문`, `사용 설명서` (최근 작업 내역 반영)
     - **개발/프로젝트 문서**: `구현계획서.md`, `README.md`, `CHANGELOG.md` (가장 마지막 수정 이후의 개선사항 요약 반영)
   - 작업 내용을 모두 갱신한 후 다음 단계로 넘어갑니다.

### --- [STEP 1: 코드 검증 및 커밋] ---

2. Run lint check:
```
npm run lint
```
Working directory: `.`

3. Verify production build:
```
npm run build
```
Working directory: `.`

4. Stage all changes:
```
git add .
```
Working directory: `.`

5. Show staged changes summary:
```
git status --short
```
Working directory: `.`

6. Commit (메시지는 에이전트가 변경 내용 기반으로 한글 작성):
```
git commit -m "변경 사항 요약"
```
Working directory: `.`

7. Push to remote:
```
git push
```
Working directory: `.`
