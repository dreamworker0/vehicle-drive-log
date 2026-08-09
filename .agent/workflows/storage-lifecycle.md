---
description: Cloud Storage 버킷에 수명 주기(자동 삭제) 규칙을 적용해 보관 요금을 억제하는 워크플로우 파일
---

# Cloud Storage 자동 삭제(Lifecycle) 설정 워크플로우

버킷이 **둘**이고 규칙 파일도 **둘**이다. 서로 대상이 다르니 섞어 적용하지 말 것
(prefix가 안 맞으면 아무것도 삭제되지 않고, 조용히 요금만 쌓인다).

| 버킷 | 위치 | 규칙 파일 | 대상 | 보관 |
|---|---|---|---|---|
| `vehicle-drive-log.firebasestorage.app` (기본) | us-east1 | `storage-lifecycle.json` | `temp/`·`ocr_images/` prefix만 | 30일 |
| `vehicle-drive-log-backups` (백업 전용) | asia-northeast3 | `storage-lifecycle-backups.json` | 버킷 전체 | 90일 |

- 기본 버킷에는 사용자 업로드(고유번호증·피드백 등)가 함께 있으므로 **prefix 한정**이다.
  전체 삭제 규칙을 걸면 살아 있는 데이터가 지워진다.
- 백업 버킷은 매일 전체 export만 쌓이므로 전체 대상이어도 안전하다. 보관을 30일이 아니라
  90일로 둔 이유는, 데이터 사고를 한 달 넘게 지나 발견하는 일이 드물지 않은데 그때 백업이
  이미 없으면 소용이 없기 때문이다. 일 37MB 기준 90일 누적 약 3.3GB(월 100원 수준).
- 백업 버킷이 왜 별도로 필요한지는 [OPERATIONS §4.1](../../OPERATIONS.md) 참고 —
  Firestore export는 DB와 같은 리전의 버킷만 받는데 기본 버킷은 us-east1이다.

## 적용

콘솔에서도 할 수 있지만(버킷 → 수명 주기 탭 → 규칙 추가), 파일로 적용하면 규칙이 레포에
남아 재현된다. **GCP CLI 설치·로그인**이 먼저 필요하다.

1. 로그인·프로젝트 확인
   ```bash
   gcloud auth login
   gcloud config set project vehicle-drive-log
   ```

2. 각 버킷에 해당 규칙 적용
   ```bash
   gcloud storage buckets update gs://vehicle-drive-log.firebasestorage.app \
     --lifecycle-file=storage-lifecycle.json

   gcloud storage buckets update gs://vehicle-drive-log-backups \
     --lifecycle-file=storage-lifecycle-backups.json
   ```

3. 적용 확인
   ```bash
   gcloud storage buckets describe gs://vehicle-drive-log-backups \
     --format="default(lifecycle)"
   ```

규칙은 하루 한 번 배치로 평가되므로 즉시 반영되지 않는다. 콘솔의 수명 주기 탭이 비어 있으면
아직 적용되지 않은 것이다 — 기본 버킷 쪽은 예전 문서가 존재하지 않는 `.appspot.com` 버킷을
예시로 들고 있었으므로, **한 번도 적용된 적이 없을 수 있다.** 탭을 먼저 확인할 것.
