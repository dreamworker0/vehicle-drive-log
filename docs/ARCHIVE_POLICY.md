# 아카이빙 정책 문서

> 최종 점검일: 2026-03-21

## 현재 정책

### `archiveDriveLogs` 스케줄 함수
- **실행 주기**: 매일 04:30 KST (UTC 19:30)
- **기준**: 3년 이상 된 운행 기록 (`timestamp < 3년 전`)
- **배치 크기**: 1회 최대 500건
- **재시도**: 1회 (`retryCount: 1`)
- **처리 흐름**:
  1. `driveLogs` 컬렉션에서 3년 이상 된 문서 500건 조회
  2. GCS에 JSON 파일로 저장 (`archives/driveLogs/{날짜}_{건수}records.json`)
  3. Firestore에서 해당 문서 일괄 삭제 (batch)

### GCS 아카이브 파일 구조
```
gs://{bucket}/archives/driveLogs/
├── 2026-03-21_500records.json
├── 2026-03-20_123records.json
└── ...
```

각 파일 메타데이터:
- `archivedAt`: 아카이브 실행 시점 ISO 문자열
- `recordCount`: 포함된 레코드 수

---

## 복원 절차

### 1. 아카이브 파일 찾기
```bash
# GCS에서 아카이브 파일 목록 확인
gsutil ls gs://{bucket}/archives/driveLogs/

# 특정 날짜의 아카이브 다운로드
gsutil cp gs://{bucket}/archives/driveLogs/2026-03-21_500records.json ./
```

### 2. 데이터 확인
```bash
# 내용 미리보기
cat 2026-03-21_500records.json | python -m json.tool | head -50
```

### 3. Firestore 복원 (필요시)
```typescript
// Node.js 스크립트로 복원
const data = JSON.parse(fs.readFileSync('2026-03-21_500records.json'));
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
