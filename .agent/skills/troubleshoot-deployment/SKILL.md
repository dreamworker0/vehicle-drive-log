---
name: troubleshoot-deployment
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

### 2.5 새 시크릿·새 공개 HTTP 함수 첫 배포 시 IAM 권한 거부 (403 setIamPolicy)
**증상**: CI 배포의 "Deploy Functions & Rules" 단계가 아래 중 하나로 실패.
- `Permission 'secretmanager.secrets.setIamPolicy' denied for resource '.../secrets/<NAME>'`
- `Missing required permission ... cloudfunctions.functions.setIamPolicy ... to deploy the following functions: <fn>`

**원인**: CI 배포 서비스계정(`firebase-adminsdk-fbsvc@vehicle-drive-log.iam.gserviceaccount.com`)은 `roles/editor`를 갖는데, **Editor 역할에는 `setIamPolicy` 계열 권한이 빠져 있다**(IAM 정책 변경은 admin/owner 역할에만 포함). 그래서:
- **새 `defineSecret`을 쓰는 함수를 처음 배포**하면, 런타임 SA(`1066541065552-compute@developer.gserviceaccount.com`)에 시크릿 읽기 권한(secretAccessor)을 걸어야 하는데 그 IAM 설정에서 막힌다. (기존 시크릿은 바인딩이 이미 있어 재배포 시 통과)
- **새 공개 HTTP 함수(onRequest, 미인증 호출용 — 예: 웹훅)를 처음 배포**하면, invoker를 공개(allUsers)로 여는 초기 IAM 설정에서 막힌다. (기존 HTTP 함수는 이미 바인딩이 있어 통과)

**해결책** (프로젝트 소유자가 1회 부여, 이후 영구히 자동 처리):
- **새 시크릿**: 런타임 SA에 시크릿별 읽기 권한을 미리 부여하면, 배포 시 CLI가 "이미 있음"을 확인하고 setIamPolicy 호출을 건너뛴다.
  ```bash
  gcloud secrets add-iam-policy-binding <SECRET_NAME> \
    --member="serviceAccount:1066541065552-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor" --project=vehicle-drive-log
  ```
- **새 공개 HTTP 함수**: 배포 SA에 Cloud Functions Admin 역할 부여(`cloudfunctions.functions.setIamPolicy` 포함). 이미 있는 Editor에 더해지는 것이라 실질 확장은 setIamPolicy뿐.
  ```bash
  gcloud projects add-iam-policy-binding vehicle-drive-log \
    --member="serviceAccount:firebase-adminsdk-fbsvc@vehicle-drive-log.iam.gserviceaccount.com" \
    --role="roles/cloudfunctions.admin"
  ```
- 권한 부여 후 실패한 배포를 재실행: `gh run rerun <deploy_run_id> --failed`.
- 순수 백그라운드 트리거(onDocumentCreated 등)는 공개 invoker가 아니므로 이 문제 없음. **공개 onRequest만** 해당.
- 참고: 시크릿 값 갱신(`firebase functions:secrets:set`) 후에는 함수 재배포가 있어야 새 버전이 반영된다. 로컬 재배포 프롬프트(`Y/n`)는 **n**(로컬 배포 금지) 후 CI 재배포로 반영.

### 2.6 Firestore 백업(export)이 `7 PERMISSION_DENIED: The caller does not have permission`
**증상**: `dailyNightlyBatch`의 `backupFirestore` 스텝만 매일 밤 실패. Sentry 컨텍스트는
`{ "context": "dailyNightlyBatch", "step": "backupFirestore" }`.

**원인은 둘 중 하나이고, 에러 문구만으로는 구분되지 않는다.**

1. **대상 버킷이 존재하지 않음** (실제 원인이었던 쪽). export 코드가
   `gs://${projectId}.appspot.com/...`을 하드코딩하고 있었는데, **2024-10 이후 생성된 Firebase
   프로젝트의 기본 버킷은 `${projectId}.firebasestorage.app`**이고 `.appspot.com` 버킷은 아예
   없다. Firestore Admin API는 "없는 버킷"을 존재 여부 노출 방지 차원에서 **권한 거부로 보고**한다.
   → 지금은 `getStorage().bucket().name`(= admin SDK 기본 버킷)을 쓰므로 재발하지 않는다.
   버킷을 다시 하드코딩하지 말 것.
2. **런타임 SA의 export 권한 누락**. Cloud Functions 런타임 SA
   (`1066541065552-compute@developer.gserviceaccount.com`)에 export 권한과 대상 버킷 쓰기 권한이 필요하다.
   ```bash
   gcloud projects add-iam-policy-binding vehicle-drive-log \
     --member="serviceAccount:1066541065552-compute@developer.gserviceaccount.com" \
     --role="roles/datastore.importExportAdmin"

   gcloud storage buckets add-iam-policy-binding gs://vehicle-drive-log.firebasestorage.app \
     --member="serviceAccount:1066541065552-compute@developer.gserviceaccount.com" \
     --role="roles/storage.admin"
   ```

**구분법**: 에러 메시지에 `outputUriPrefix=gs://...`가 붙어 있으므로 그 버킷이
`firebase storage:buckets:list`(또는 Console → Storage) 목록에 있는지 먼저 본다. 있으면 2번(IAM),
없으면 1번(버킷 오지정)이다.

### 2.7 야간 배치 쿼리가 `9 FAILED_PRECONDITION: The query requires an index`
**증상**: 스케줄 함수 로그/Sentry에 인덱스 생성 링크가 포함된 에러. 예: `organizations`의
`status` + `deletedAt`.

**원인**: `orderBy` 없이 부등호(`<=`, `<`)로 거르는 쿼리는 Firestore가 **부등호 필드 오름차순**을
암묵 적용한다. 화면 쪽에 같은 필드 조합의 **내림차순** 인덱스가 이미 있어도 그것으로는 커버되지
않는다(`purgeOrgs`가 정확히 이 함정에 걸렸다 — 화면은 `deletedAt desc`, 배치는 암묵 `asc`).

**해결책**: 콘솔 링크로 즉석 생성하지 말고 **`firestore.indexes.json`에 추가**한 뒤 배포한다
(콘솔에서만 만들면 다음 `firebase deploy --only firestore:indexes`에서 사라진다).
방향은 쿼리 그대로 — 배치용은 `ASCENDING`, 화면 목록용은 `DESCENDING`으로 **둘 다** 둔다.

## 3. 롤백 전략 (긴급 복구 시)
앱 배포 직후 치명적인 오류(예: App Check 적용 후 대량 인증 실패)가 발생하면, 즉각적인 문제 분석보다 **원복(Rollback)**이 우선입니다.
- **프론트엔드 롤백**: `firebase hosting:rollback` 명령 실행
- **수동 원복 후 배포**: 문제가 발생한 커밋 이전으로 `git revert`를 수행한 후, `/deploy` 워크플로우를 재실행합니다.
