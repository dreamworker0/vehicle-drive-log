---
name: 배포 트러블슈팅 (troubleshoot-deployment)
description: Cloud Functions, 프론트엔드 빌드 및 배포 시 발생하는 다양한 오류(Node 버전, 의존성 충돌, 소스맵)의 해결 패턴을 모아둔 가이드.
---

# 배포 트러블슈팅 가이드 (Troubleshoot Deployment)

## 1. 목적
로컬 머신이나 CI/CD 환경에서 Firebase 배포 시 자주 발생하는 패턴을 파악하고, 에이전트가 이를 빠르고 정확하게 진단·해결하도록 돕습니다.

## 2. 대표적인 에러 패턴 및 해결책

### 2.1 ERESOLVE unable to resolve dependency tree
**증상**: `npm install` 실행 시 의존성 트리 충돌로 인해 설치가 중단됨.
**원인**: 주로 `firebase-functions`, `firebase-admin` 버전과 관련된 하위 플러그인 호환성 문제.
**해결책**: 
- `package.json`의 `overrides` 필드를 활용해 충돌하는 의존성의 버전을 강제 지정한다.
  ```json
  "overrides": {
      "minimatch": ">=9.0.5"
  }
  ```
- 임시 방편으로 `--legacy-peer-deps`를 쓸 수 있지만 권장하지 않음.

### 2.2 Rollup Stack Overflow / Build Memory Issue
**증상**: 프론트엔드 `npm run build` 중 스택 오버플로우나 메모리 부족으로 크래시 발생.
**원인**: Node 24 등 최신 버전과 Vite/Rollup 플러그인 간 호환성 문제.
**해결책**:
- **반드시 Node 22 LTS 환경**으로 전환 후 빌드한다.
- 로컬 환경: `fnm use 22` 실행 후 빌드 재시도.

### 2.3 Cloud Functions 배포 시 "Could not find source" 오류
**증상**: Functions 배포 시 타겟 모듈을 찾을 수 없거나 구문 오류가 발생했다고 나옴.
**원인**: TypeScript 컴파일 결과를 GCP(Cloud Build)가 인식하지 못하거나, `main` 진입점이 잘못됨.
**해결책**:
1. `functions/package.json`에서 `gcp-build: ""` 스크립트 추가 확인 (Cloud Build 이중 빌드 방지).
2. `functions/package.json`의 `main` 속성이 트랜스파일 결과물(`lib/functions/src/index.js` 또는 `lib/index.js`)을 올바르게 가리키는지 확인.
3. 로컬에서 사전에 `cd functions && npm run build`를 통해 `lib` 폴더가 정상 생성되었는지 검증.

### 2.4 auth/invalid-api-key 에러 (Vitest 로컬 테스트)
**증상**: `npm test` 시 "Firebase: Error (auth/invalid-api-key)." 등 인증 에러 발생.
**원인**: 테스트 환경(Vitest)에 Firebase 초기화에 필요한 `VITE_FIREBASE_API_KEY` 환경변수가 제대로 로딩되지 않거나 Mocking되지 않음.
**해결책**:
- `vite.config.ts`의 test 섹션에서 `env` 변수를 명시적으로 로드하거나 Mock 설정(`vi.mock`)을 통해 Firebase 초기화 부분을 모의(Mock) 객체로 우회한다.

## 3. 롤백 전략 (긴급 복구 시)
앱 배포 직후 치명적인 오류(예: App Check 적용 후 대량 인증 실패)가 발생하면, 즉각적인 문제 분석보다 **원복(Rollback)**이 우선입니다.
- **프론트엔드 롤백**: `firebase hosting:rollback` 명령 실행
- **수동 원복 후 배포**: 문제가 발생한 커밋 이전으로 `git revert`를 수행한 후, `/deploy` 워크플로우를 재실행합니다.
