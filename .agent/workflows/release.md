---
description: 프로젝트 버전업 및 배포 전 릴리즈 태그와 노트 생성 자동화
---
# /release 워크플로우

새로운 버전 배포를 준비하고, 깃 태그를 생성하는 파이프라인. 배포 전 변경사항이나 의존성 업데이트를 최종 점검할 때 사용합니다.

1. **상태 검증 & Lint 체크**
   - 워크스페이스가 깨끗한지(`git status`) 확인합니다.
   - `npm run lint` 로 잠재적인 문법 오류가 없는지 파악합니다.

2. **버전 올리기**
   사용자의 지시에 따라(Patch, Minor, Major 중 하나) 버전을 올립니다.
   ```bash
   npm version patch -m "chore: bump version to %s"
   ```

3. **Changelog 발췌**
   최근 릴리즈(직전 Tag) 이후의 커밋 로그를 보여주어 사용자가 릴리즈 노트 초안을 작성하게 돕거나, AI가 이를 요약해줍니다.

4. **Sentry Release 연동 (권장)**
   명시적으로 Sentry CLI를 사용하거나, 새 버전에 매칭되는 Sentry Release 태그가 제대로 파싱되어 연동될 수 있는지 점검합니다. 필요한 경우 릴리즈 노트를 Sentry 측에도 업데이트합니다.

5. **Git push**
   생성된 Tag와 함께 푸시합니다.
   ```bash
   git push origin master
   git push origin --tags
   ```
