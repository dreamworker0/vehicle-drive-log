---
description: Firestore 주요 데이터 백업 및 오프라인 보관 자동화 스크립트 도우미
---
# /db-export (Firestore 로컬 백업) 워크플로우

로컬 에뮬레이터에서 프로덕션과 유사한 데이터 환경을 구축해야 하거나, 만일을 대비한 데이터셋(`backup_data` / `seeds`)을 만들어 보관할 때 사용합니다.

1. **원격 Firestore 데이터 추출 (예: gcloud 활용)**
   원래 GCP CLI가 필요하지만, 간이로 Node 스크립트를 짜서 `admin.firestore().collection('vehicles').get()` 로 특정 컬렉션만 JSON으로 내려받습니다.
   
2. **에이전트에게 백업 스크립트 생성 요청**
   데이터 백업 스크립트는 `scripts/db-export.js` 위치에 생성해 달라고 하고, 이를 Node를 통해 실행합니다.
   
3. **Seed 데이터 보관**
   결과물인 `vehicles.json` 등을 `seeds/` 디렉토리에 보관하여 테스트 환경에서 `import` 할 수 있게 유지합니다.
