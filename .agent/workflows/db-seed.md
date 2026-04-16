---
description: Firebase 로컬 Emulator에 프론트엔드 및 E2E 테스트용 더미 데이터를 자동 주입하는 스크립트 도우미
---

# 로컬 DB 시드 주입 스크립트 (DB Seed)

로컬 개발(Local Emulator) 서버에 개발 및 E2E 테스트 목적으로 가상의 데이터를 주입합니다.
UI를 검증하거나 E2E 테스트 오프라인/엣지 케이스 시나리오를 만들 때 매우 유용합니다.

> [!WARNING]
> 이 스크립트는 **반드시 로컬 Emulator 환경**(`FIRESTORE_EMULATOR_HOST`)을 타겟으로 실행해야 합니다. 실제 프로덕션 DB에 실행되지 않도록 주의하세요!

## 1. 전제 조건
- Firebase Local Emulator가 이미 실행 중이어야 합니다 (`npm run dev:firebase` 등).
- Node 환경 스크립트를 사용하여 DB를 초기화하거나 데이터를 푸시합니다.

## 2. 시드 스크립트 생성 (최초 1회)
만약 주입용 스크립트 파일명(`scripts/seed-db.js` 또는 `ts`)이 없다면, 에이전트가 다음과 같은 형태의 스크립트를 프로젝트 `scripts` 하위에 작성하도록 유도합니다.

```javascript
// scripts/seed-db.js (예시)
const admin = require("firebase-admin");
process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080"; 
admin.initializeApp({ projectId: "demo-project" });
const db = admin.firestore();

async function seed() {
  const users = ["test1@example.com", "test2@example.com"];
  // 1. 사용자 셋업
  // 2. 차량 정보 컬렉션 추가
  // 3. 운행 일지 50건 주입 로직...
  console.log("Seeding complete.");
}
seed();
```

## 3. 시드 스크립트 실행
스크립트가 준비되어 있다면 아래 명령어로 즉시 주입합니다.

```bash
// turbo
node scripts/seed-db.js
```

---
> **완료 메세지**
> 더미 데이터 주입이 완료되었습니다. 대시보드를 새로고침하여 데이터가 정상적으로 화면에 렌더링되는지 확인해 주세요.
