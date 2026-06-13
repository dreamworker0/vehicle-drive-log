---
name: firebase-cost-reduction
description: Firebase 운영 비용(Functions 호출·스케줄, Hosting/Storage, 집계 쿼리, 모니터링 쿼터) 절감 패턴 가이드. 비용 절감, 무료 한도 초과, 스케줄 축소, 풀스캔 제거 작업 시 참고.
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

## 체크리스트 (비용 영향 작업 시)

- [ ] 새 스케줄 함수의 빈도가 최소인가? 트리거로 대체 가능한가?
- [ ] 건수/합계만 필요한데 `getDocs` 풀스캔하고 있지 않은가? → `getCountFromServer`
- [ ] 모든 데이터 쿼리에 기간 제한이 있는가? (→ firestore-query-optimization §2)
- [ ] 프리뷰/임시 채널에 만료가 설정됐는가?
- [ ] 새 외부 API(OCR 등) 호출에 캐시·중복 방지가 있는가?
