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
  ```powershell
  gcloud secrets add-iam-policy-binding <SECRET_NAME> --member="serviceAccount:1066541065552-compute@developer.gserviceaccount.com" --role="roles/secretmanager.secretAccessor" --project=vehicle-drive-log
  ```
- **새 공개 HTTP 함수**: 배포 SA에 Cloud Functions Admin 역할 부여(`cloudfunctions.functions.setIamPolicy` 포함). 이미 있는 Editor에 더해지는 것이라 실질 확장은 setIamPolicy뿐.
  ```powershell
  gcloud projects add-iam-policy-binding vehicle-drive-log --member="serviceAccount:firebase-adminsdk-fbsvc@vehicle-drive-log.iam.gserviceaccount.com" --role="roles/cloudfunctions.admin"
  ```
- 권한 부여 후 실패한 배포를 재실행: `gh run rerun <deploy_run_id> --failed`.
- 순수 백그라운드 트리거(onDocumentCreated 등)는 공개 invoker가 아니므로 이 문제 없음. **공개 onRequest만** 해당.
- 참고: 시크릿 값 갱신(`firebase functions:secrets:set`) 후에는 함수 재배포가 있어야 새 버전이 반영된다. 로컬 재배포 프롬프트(`Y/n`)는 **n**(로컬 배포 금지) 후 CI 재배포로 반영.

### 2.6 Firestore 백업(export)이 `7 PERMISSION_DENIED: The caller does not have permission`
**증상**: `dailyNightlyBatch`의 `backupFirestore` 스텝만 매일 밤 실패. Sentry 컨텍스트는
`{ "context": "dailyNightlyBatch", "step": "backupFirestore" }`.

**원인은 셋 중 하나다. 에러 문구만으로는 1·3을 구분할 수 없다.**

1. **대상 버킷이 존재하지 않음.** export 코드가 `gs://${projectId}.appspot.com/...`을
   하드코딩하고 있었는데, **2024-10 이후 생성된 Firebase 프로젝트의 기본 버킷은
   `${projectId}.firebasestorage.app`**이고 `.appspot.com` 버킷은 아예 없다. Firestore Admin API는
   "없는 버킷"을 존재 여부 노출 방지 차원에서 **권한 거부로 보고**한다.
   → 지금은 export 전에 `bucket.exists()`로 먼저 확인해 "백업 버킷이 없다"고 명시적으로 실패한다.
   버킷 이름을 다시 하드코딩하지 말 것.
2. **버킷 위치 불일치** — 1번을 고치자 드러난 진짜 벽. Firestore 관리형 export는 **데이터베이스와
   같은 위치의 버킷만** 받는다. 이 프로젝트의 Firestore는 `asia-northeast3`인데 Firebase 기본
   버킷은 **`us-east1`**이라, 기본 버킷을 쓰면 PERMISSION_DENIED가 아니라 이 400이 난다:
   ```
   Bucket ...firebasestorage.app is in location us-east1.
   This database can only operate on buckets spanning location asia or asia-northeast3.
   ```
   버킷 위치는 생성 후 변경할 수 없다. → **Firestore와 같은 리전에 백업 전용 버킷**
   (`{projectId}-backups`)을 두고, `FIRESTORE_BACKUP_BUCKET`으로 덮어쓸 수 있게 했다.
   기본 버킷을 export 대상으로 되돌리지 말 것. (아카이빙·이미지 정리는 위치 제약이 없어 기본 버킷 사용.)
3. **export 실행 계정의 버킷 쓰기 권한 누락.** export는 런타임 SA가 아니라 **Firestore 서비스 에이전트**
   `service-{projectNumber}@gcp-sa-firestore.iam.gserviceaccount.com`로 실행된다
   (Console → Firestore → 가져오기/내보내기 화면 상단에 표시). 같은 프로젝트 버킷이면 보통 자동으로
   되지만, 안 되면 그 계정에 버킷 쓰기를 준다.
   ```powershell
   gcloud storage buckets add-iam-policy-binding gs://vehicle-drive-log-backups --member="serviceAccount:service-1066541065552@gcp-sa-firestore.iam.gserviceaccount.com" --role="roles/storage.admin"
   ```
   호출을 거는 런타임 SA(`1066541065552-compute@developer.gserviceaccount.com`)에는 export 권한이 필요하다.
   **`roles/editor`로는 안 된다** — Editor에는 Firestore import/export 권한이 빠져 있고, 그래서
   `datastore.importExportAdmin`이 별도 역할로 존재한다(2026-08-10에 런타임 SA가 Editor를
   갖고 있는데도 export가 거부되던 상태가 이것이었다).
   ```powershell
   gcloud projects add-iam-policy-binding vehicle-drive-log --member="serviceAccount:1066541065552-compute@developer.gserviceaccount.com" --role="roles/datastore.importExportAdmin"
   ```

   > ⚠️ **명령은 한 줄로 쓴다.** 이 서비스의 조치는 Windows PowerShell에서 이뤄지는데,
   > bash식 줄바꿈(`\`)을 그대로 붙여 넣으면 `단항 연산자 '--' 뒤에 식이 없습니다`로 깨진다
   > (실제로 그렇게 한 번 실패했다). PowerShell의 연결 문자는 백틱(`` ` ``)이다.

**구분법**: 에러 메시지에 `outputUriPrefix=gs://...`가 붙는다.
- `... is in location ...` 문구가 있으면 **2번**(위치) — 리전 맞는 버킷을 새로 만든다.
- "백업 버킷이 ... 없다"면 **1번**(버킷 부재).
- 버킷이 존재하고 리전도 맞는데 PERMISSION_DENIED면 **3번**(IAM).
  이 경우 코드가 **판정과 조치 명령을 에러 메시지에 함께 싣는다**(`describeExportFailure`) —
  알림만 보고 바로 조치할 수 있고, 문서를 뒤지는 것은 계정 값이 필요할 때뿐이다.

**3번 안에서 둘 중 무엇인지**: 런타임 SA와 서비스 에이전트 중 어느 쪽인지는 **거부가 언제
났는지**로 갈린다. `exportDocuments`는 장기 실행 작업이라, **호출 즉시** 동기적으로 떨어지는
거부는 대개 호출자(런타임 SA)의 `datastore.databases.export` 누락이다("The caller does not
have permission"이라는 문구도 호출자를 가리킨다). 서비스 에이전트의 버킷 쓰기 누락은 작업이
시작된 **뒤** 드러나는 쪽에 가깝다. 그래서 조치는 **런타임 SA → 서비스 에이전트 순서**로 건다.

> ⚠️ **작업 시작 후의 실패는 지금 아무도 못 잡는다.** 코드는 `exportDocuments`를 걸고
> "backup started"만 남긴 뒤 끝난다(장기 실행 작업의 완료를 기다리지 않는다). 즉 **알림이
> 없는데도 백업이 없을 수 있다** — 확인은 버킷의 오늘 폴더를 직접 보는 것뿐이다.

**진단 지름길**: 수동 export를 한 번 돌려 보면 세 원인이 즉시 갈린다. 스케줄러를 하루 기다릴 필요가 없다.
작은 컬렉션만 지정하면 비용도 거의 들지 않는다.

```powershell
gcloud firestore export gs://vehicle-drive-log-backups/backups/firestore/manual-test --collection-ids=system --project vehicle-drive-log
```

**이 명령은 사람(Owner) 자격으로 돌기 때문에 두 원인을 갈라 준다.**
- 성공 → 서비스 에이전트는 버킷을 쓸 수 있다. 남은 변수는 호출자(런타임 SA) 권한뿐이므로
  3번의 두 번째 명령만 걸면 된다.
- `PERMISSION_DENIED` → 서비스 에이전트의 버킷 쓰기가 막힌 것이다. 3번의 첫 번째 명령을 건다.

**같은 스텝의 다른 문구 — `3 INVALID_ARGUMENT: Path already exists: .../<날짜>.overall_export_metadata`**
는 위 셋 중 어느 것도 아니다. **백업은 이미 있고**, 배치가 같은 날 두 번 돈 것이다. export는
`outputUriPrefix`의 마지막 조각으로 완료 표식을 만드는데 대상 경로가 날짜로 고정돼 있어,
두 번째 실행이 그 표식과 부딪힌다. 배치가 하루 두 번 도는 경로는 세 가지다 — 스케줄 함수의
Pub/Sub 전달이 at-least-once, `retryCount: 1`(핸들러가 타임아웃 등으로 던지면 1회 재실행),
운영자의 수동 재실행. 셋 다 정상 동작이라 막을 대상이 아니다.
→ 지금은 export 전에 오늘 접두사 아래 객체가 있는지 보고 있으면 건너뛴다(`backupFirestoreData`).
사전 확인과 호출 사이의 경합으로 이 에러가 나도 실패로 올리지 않는다. **이 문구가 다시 보이면
스킵 로직이 지워진 것**이니 IAM을 뒤지지 말고 그쪽을 먼저 본다. 중복 export를 "그냥 하나 더
만들면 되지"로 풀지 말 것 — 관리형 export는 전체 문서를 읽어 읽기 비용이 그대로 청구된다.

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
