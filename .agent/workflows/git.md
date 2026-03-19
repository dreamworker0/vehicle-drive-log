---
description: Git 스테이징, 커밋, 푸시를 한번에 실행
---
// turbo-all

1. Run lint check:
```
npm run lint
```
Working directory: `.`

2. Verify production build:
```
npm run build
```
Working directory: `.`

3. Stage all changes:
```
git add .
```
Working directory: `.`

4. Show staged changes summary:
```
git status --short
```
Working directory: `.`

5. Commit (메시지는 에이전트가 변경 내용 기반으로 한글 작성):
```
git commit -m "변경 사항 요약"
```
Working directory: `.`

6. Push to remote:
```
git push
```
Working directory: `.`
