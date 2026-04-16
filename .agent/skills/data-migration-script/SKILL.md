---
name: "data-migration-script"
description: "기존 Firestore 데이터 구조가 변경될 때 사용할 일회성 데이터를 일괄 백그라운드로 갱신하는 배치(Batch) 마이그레이션 스크립트 패턴"
---

# data-migration-script 가이드

Firestore 컬렉션의 스키마 필드가 변경되었거나, 기존 레거시 문서를 새로운 형식으로 모두 변환해야 할 때 이 패턴을 따릅니다.
수만 건 이상의 데이터를 처리하기 때문에 메모리를 초과하지 않도록 **Pagination**과 **Batch Write**가 필수입니다.

## 1. 스크립트 작성 위치 및 환경
- 이 스크립트는 클라이언트(React 앱)에서 동작하지 말아야 합니다. (실수 실행 방지)
- 가급적 Node.js가 설치된 환경에서 `.agent/scripts/`나 `/scripts/` 경로 하위에 `.ts` 또는 `.js` 파일 형태로 생성합니다.
- `firebase-admin` 라이브러리를 사용하여 실행합니다.

## 2. 배치 스크립트 패턴 예시
> [!CAUTION]
> 프로덕션 DB를 다룰 때는 항상 1~2개 도큐먼트로 먼저 테스트하고 전체 배치를 실행하세요.

```javascript
// scripts/migrate-legacy-logs.js
const admin = require("firebase-admin");
const serviceAccount = require("./service-account.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function migrate() {
  const BATCH_SIZE = 500;
  let hasNextPage = true;
  let lastVisible = null;
  let totalProcessed = 0;

  while(hasNextPage) {
    let query = db.collection('driveLogs').limit(BATCH_SIZE);
    if (lastVisible) query = query.startAfter(lastVisible);
    
    const snapshot = await query.get();
    if (snapshot.empty) {
      hasNextPage = false;
      break;
    }

    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      // 변환 규칙 적용
      if (!data.newField) {
        batch.update(doc.ref, { newField: "default_value" });
      }
    });

    await batch.commit();
    totalProcessed += snapshot.docs.length;
    lastVisible = snapshot.docs[snapshot.docs.length - 1];
    console.log(`Processed ${totalProcessed} documents...`);
  }
  
  console.log("Migration finished.");
}

migrate();
```

## 3. 에이전트 행동 지침
- "기존 데이터 필드 OOO을 XXX로 바꿔줘"라는 요청이 들어오면 앱 코드를 수정하는 것으로는 끝나지 않습니다. 
- 기존 데이터를 어떻게 갱신할 것인지 사용자에게 묻고, 이 스킬의 패턴을 본떠 마이그레이션 코드를 작성한 뒤 터미널 자동 실행을 안내해야 합니다.
