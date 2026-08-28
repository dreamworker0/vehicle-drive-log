# 아카이빙 정책 문서

> 최종 점검일: 2026-08-28 (코드 대조 완료)

## 현재 정책

### 주간 유지보수 배치의 아카이빙 스텝 (`weeklyMaintenanceBatch` → `archiveLogs`)

독립 스케줄 함수 `archiveDriveLogs`는 더 이상 없다 — 인프라 비용 절감을 위해 배치의 한 스텝으로
흡수됐다. 2026-08-28 Cloud Run 비용 점검에서 야간 배치를 셋으로 가르면서 **주간 배치로 옮겼다**
(판정 기준이 3년이라 하루 늦게 처리해도 영향이 없다).
스텝 구현은 [dailyNightlyBatch.ts](../functions/src/handlers/scheduled/dailyNightlyBatch.ts)에 그대로 있고,
호출은 [weeklyMaintenanceBatch.ts](../functions/src/handlers/scheduled/weeklyMaintenanceBatch.ts)가 한다.

- **실행 주기**: 매주 **일요일 03:00 KST** (주간 유지보수 배치에 편승)
- **기준**: 3년 이상 된 운행 기록 (`timestamp < 3년 전`)
- **배치 크기**: 1회 최대 500건
  - ⚠️ 매일 → 주 1회로 바뀌었으므로 소진 속도도 하루 500건 → **주 500건**이다. 3년 경과 기록이
    대량으로 밀려 있다면 스케줄을 일시적으로 매일로 되돌리거나 limit을 올릴 것.
- **재시도**: 없음 (`retryCount: 0`, 대상이 남으면 다음 주에 다시 처리)
- **처리 흐름**:
  1. `driveLogs` 컬렉션에서 3년 이상 된 문서 500건 조회
  2. JSON을 **gzip 압축**해 GCS에 저장 (`archives/driveLogs/{날짜}_{건수}records.json.gz`)
  3. Firestore에서 해당 문서 일괄 삭제 (batch)

### GCS 아카이브 파일 구조
```
gs://{bucket}/archives/driveLogs/
├── 2026-03-21_500records.json.gz
├── 2026-03-20_123records.json.gz
└── ...
```

각 파일 메타데이터:
- `archivedAt`: 아카이브 실행 시점 ISO 문자열
- `recordCount`: 포함된 레코드 수
- `originalSize` / `compressedSize`: 압축 전후 바이트 수

---

## 복원 절차

### 1. 아카이브 파일 찾기
```bash
# GCS에서 아카이브 파일 목록 확인
gsutil ls gs://{bucket}/archives/driveLogs/

# 특정 날짜의 아카이브 다운로드
gsutil cp gs://{bucket}/archives/driveLogs/2026-03-21_500records.json.gz ./
```

### 2. 데이터 확인
```bash
# gzip이므로 압축을 풀어 미리보기 (원본을 남기려면 -k)
gunzip -c 2026-03-21_500records.json.gz | python -m json.tool | head -50
```

### 3. Firestore 복원 (필요시)
```typescript
// Node.js 스크립트로 복원 (gzip 해제 필요)
import { gunzipSync } from 'node:zlib';
const data = JSON.parse(gunzipSync(fs.readFileSync('2026-03-21_500records.json.gz')).toString());
const batch = db.batch();
data.forEach(doc => {
    batch.set(db.collection('driveLogs').doc(doc.id), doc);
});
await batch.commit();
```

> [!CAUTION]
> 복원 시 `id` 필드를 문서 ID로 사용해야 기존 참조가 유지됨

---

## 점검 결과 & 개선 권장사항

### ✅ 적절한 부분
- 3년 보관 기준은 법적 요구사항(차량운행일지 5년 보존)에 비해 보수적이나 적절
- 500건 배치 크기는 Firestore batch 제한(500)에 맞춤
- JSON 형식 → 사람이 읽을 수 있고 복원 용이

### ⚠️ 개선 필요 사항

| 항목 | 현재 | 개선안 |
|---|---|---|
| 로깅 | `console.log` 사용 | `log()` 구조화 로깅으로 전환 |
| 500건 초과 | 1회 500건만 처리 | 루프 처리 또는 다음 실행에 위임 (현재: 다음 날 실행) |
| 아카이브 압축 | 비압축 JSON | gzip 압축으로 GCS 비용 절감 가능 |
| 복원 도구 | 없음 | 복원 스크립트/Cloud Function 제공 권장 |

> [!NOTE]
> 현재 1일 1회 실행이므로 500건 초과 데이터는 다음 날 처리됨.
> 3년간 축적된 데이터가 대량인 경우, 처음 몇 일간은 매일 500건씩 아카이빙됨.
