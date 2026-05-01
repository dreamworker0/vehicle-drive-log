---
description: 최신 코드를 배포 전 임시 URL로 올려 검증하는 파이프라인
---
# /preview 워크플로우

Hosting의 변경사항을 본 서버가 아닌 임시적인 Preview 채널로 올려 **모바일(폰)이나 다른 기기에서** 테스트할 때 사용합니다.

1. **로컬 빌드 및 점검**
   ```bash
   npm run build
   ```
   (필요 시 Vitest/Playwright 결과가 패스하는지 확인)

2. **Preview 채널 배포 (Firebase)**
   ```bash
   npx firebase hosting:channel:deploy pre-release --expires 3d
   ```
   이 명령어는 `pre-release`라는 이름의 일시적 채널을 만들고 3일 후 파기되는 링크를 터미널로 알려줍니다.

3. **결과 검토**
   생성된 배포 URL을 복사하여 모바일에서 화면 비율이나 다크모드, 팝업, 예약 플로우가 깨지지 않는지 실제 테스팅합니다.

> 💡 **CI/CD 파이프라인 (preview.yml) 참고**
> GitHub Actions에서 Preview 채널 배포를 자동화할 때, Dependabot이 생성한 PR은 Repository Secret(`firebaseServiceAccount`)에 접근할 수 없어 인증 오류가 발생합니다. `preview.yml`에 반드시 `if: ${{ github.actor != 'dependabot[bot]' }}` 조건을 추가하여 Dependabot PR의 Preview 배포를 생략하도록 설정해야 합니다.
