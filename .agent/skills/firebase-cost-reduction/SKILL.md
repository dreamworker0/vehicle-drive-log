---
name: firebase-cost-reduction
description: Firebase 인프라·운영 비용 절감 패턴 가이드 — Functions 호출·스케줄 빈도, Hosting/Storage 용량, 모니터링 쿼터, 무료 한도 초과 대응. 스케줄 축소·비용 절감 작업 시 참고. (쿼리 자체 성능·Reads 최적화는 firestore-query-optimization 참고.)
---

# Firebase 운영 비용 절감 가이드

이 프로젝트는 **사회복지기관·비영리단체용 무료 서비스**다. Firebase 무료 한도(Spark/Blaze 최소 과금) 안에서 운영하는 것이 제약 조건이므로, 기능을 추가·수정할 때 비용 증가 요인을 먼저 점검한다.

> 📌 **쿼리 레벨 Read 비용**(서버 필터링·기간 제한·배치·집계 캐싱)은 [firestore-query-optimization](../firestore-query-optimization/SKILL.md)을 따른다. 이 스킬은 **쿼리 바깥의 비용 요인**(스케줄, 호스팅, 집계 쿼리 종류, 모니터링)을 다룬다.

## 1. 스케줄 함수 빈도 최소화

Cloud Scheduler 호출과 Functions 실행은 빈도에 비례해 과금된다. 주기적 작업을 추가할 때:

- **꼭 필요한 최소 빈도**로 설정한다. 대시보드 통계처럼 실시간성이 낮은 작업은 시간 단위가 아니라 하루 1~2회로 충분한지 먼저 따진다. (커밋 `4394987`: 대시보드 통계 스케줄 축소)
- 사용자 트래픽이 없는 새벽 시간대(`Asia/Seoul`)로 몰아 cold start·동시성 비용을 줄인다.
- 이벤트가 드물면 스케줄(폴링) 대신 **트리거 기반**으로 전환할 수 있는지 검토한다.

```typescript
// ❌ 매시간 — 실시간성이 불필요한데 호출 24배
export const computeStats = onSchedule({ schedule: 'every 1 hours', ... }, ...);

// ✅ 하루 2회로 충분
export const computeStats = onSchedule(
  { schedule: '0 6,18 * * *', timeZone: 'Asia/Seoul', region: 'asia-northeast3' },
  ...
);
```

## 2. 집계는 count()/aggregation 쿼리로 — 문서 풀스캔 금지

"건수"나 합계만 필요할 때 전체 문서를 `getDocs`로 읽으면 문서 수만큼 Read 과금된다. **`getCountFromServer` / aggregation 쿼리**는 결과 1건 비용으로 처리된다.

- "전체 N건 + 최근 데이터"가 동시에 필요하면, **count() 쿼리**와 **기간 제한 데이터 쿼리**를 분리한다. (커밋 `7c40dcd`: driveLogs 전체 풀스캔 → count() + 45일 필터 분리)

```typescript
import { getCountFromServer, query, where } from 'firebase/firestore';

// 총 건수는 count()로 (문서 안 읽음)
const total = (await getCountFromServer(query(col, where('organizationId', '==', orgId)))).data().count;
// 화면에 그릴 데이터는 기간 제한해서만 읽음
const recent = await getDocs(query(col, where('organizationId', '==', orgId), where('date', '>=', cutoff45d)));
```

## 3. Hosting 프리뷰 채널 만료 설정

PR 프리뷰/임시 배포 채널은 만료 설정 없이 두면 Storage·Hosting 비용이 누적된다. 프리뷰 채널 생성 시 `--expires`(예: `7d`)를 지정한다. (커밋 `4394987`: 프리뷰 만료 설정으로 비용 절감, [.github/workflows/preview.yml](../../../.github/workflows/preview.yml))

## 4. Storage 수명주기 / OCR 비용

- 업로드 이미지·임시 산출물은 Storage 수명주기 규칙으로 자동 삭제한다 → [storage-lifecycle 워크플로우](../../workflows/storage-lifecycle.md).
- Gemini OCR은 호출당 과금이므로 호출 전 캐시/중복 방지를 확인한다 → [gemini-ocr-integration](../gemini-ocr-integration/SKILL.md), [ocr-cost-security 규칙](../../rules/ocr-cost-security.md).

## 5. 모니터링 쿼터 (Sentry 등)

Sentry 이벤트 한도도 비용/쿼터 요인이다. 노이즈 에러가 한도를 잠식하지 않도록 [sentry-noise-filter](../sentry-noise-filter/SKILL.md)로 필터링한다.

## 6. 콜드스타트 번들 비용 — 무거운 패키지는 최상단에서 import하지 않는다

Cloud Functions v2는 Cloud Run으로 과금되고, **인스턴스 기동 시간도 vCPU-초로 청구된다.** 그런데 `index.ts` 하나가 모든 함수를 한 번들로 묶으므로 **어떤 함수가 콜드스타트하든 index.ts가 끌어오는 모든 모듈을 전부 로드한다.** 두 함수만 쓰는 패키지의 로드 비용을 나머지 함수 전부가 매 콜드스타트마다 대신 낸다.

측정(2026-08-28, Node 22 기준 `require` 시간):

| 패키지 | 로드 시간 | 실제 사용 함수 |
|---|---|---|
| `googleapis` | **874 ms** | 캘린더 관련 2곳 |
| `@sentry/node` | 316 ms | 전역(필요) |
| `firebase-functions` | 264 ms | 전역(필요) |
| `@google/genai` | 99 ms | Gemini 계열 소수 |

`googleapis`를 지연 로드로 돌린 것만으로 `index.js` 전체 로드가 **1,190 ms → 445 ms**로 줄었다.

```typescript
// ❌ 최상단 import — 캘린더와 무관한 함수까지 매 콜드스타트마다 0.9초를 문다
import { google, calendar_v3 } from 'googleapis';

// ✅ 타입은 컴파일 시 지워지고(import type), 런타임 객체는 호출 시점에만 로드한다
import type { calendar_v3 } from 'googleapis';

async function getCalendarClient(): Promise<calendar_v3.Calendar> {
  const { google } = await import('googleapis');   // Node 모듈 캐시가 2회차부터 받아 준다
  ...
}
```

판단 기준: **`index.ts`에서 export되는 함수 중 소수만 쓰는 무거운 의존성**(googleapis·SDK류)은 `await import()`로 내린다. 전 함수가 쓰는 것(firebase-admin, firebase-functions, Sentry)은 그대로 둔다.

## 체크리스트 (비용 영향 작업 시)

- [ ] 새 스케줄 함수의 빈도가 최소인가? 트리거로 대체 가능한가?
- [ ] 건수/합계만 필요한데 `getDocs` 풀스캔하고 있지 않은가? → `getCountFromServer`
- [ ] 모든 데이터 쿼리에 기간 제한이 있는가? (→ firestore-query-optimization §2)
- [ ] 프리뷰/임시 채널에 만료가 설정됐는가?
- [ ] 새 외부 API(OCR 등) 호출에 캐시·중복 방지가 있는가?
- [ ] 새로 추가한 무거운 패키지를 함수 파일 최상단에서 import하고 있지 않은가? (→ §6)
