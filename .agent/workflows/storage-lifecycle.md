---
description: Cloud Storage의 임시 폴더에 쌓이는 데이터에 수명 주기를 설정하여 비용을 절감하는 워크플로우 파일
---

# Cloud Storage 자동 삭제(Lifecycle) 설정 워크플로우

Firebase Cloud Storage는 시간이 지남에 따라 임시 파일들(`temp/`, `ocr_images/` 등)이 누적되어 하드디스크 보관 요금이 증가할 수 있습니다. 
이를 방지하기 위해 생성해놓은 `storage-lifecycle.json` 규칙을 수명 주기에 등록해야 합니다.

이 워크플로우를 실행하려면 먼저 **GCP(Google Cloud CLI)가 설치**되어 있고, 로그인이 되어 있어야 합니다.

1. 터미널(혹은 PowerShell)에서 다음 명령을 실행하여 현재 로그인 상태와 프로젝트를 확인합니다.
```bash
gcloud auth login
gcloud config set project [YOUR_PROJECT_ID]
```

2. 루트 경로에 저장된 `storage-lifecycle.json` 파일을 대상 스토리지 버킷에 적용합니다. `vehicle-drive-log.appspot.com` 등 본인의 스토리지 버킷 주소를 넣으세요.
```bash
gsutil lifecycle set storage-lifecycle.json gs://[YOUR_BUCKET_NAME]
```

3. 올바르게 설정되었는지 다음 명령으로 확인합니다.
```bash
gsutil lifecycle get gs://[YOUR_BUCKET_NAME]
```

위 명령어들을 통해 30일이 초과한 특정 폴더 안의 이미지들은 완전히 자동 삭제되어 추가 요금 청구를 막아줍니다.
