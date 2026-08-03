/**
 * recordExport — 내보내기(반출) 사실을 접속기록에 남긴다
 *
 * 근거: 고시 제16조. Phase 123은 전면 열람 로그를 하지 않기로 결정했다 —
 * 로그가 원본보다 커지고, 실질 위험은 개별 조회가 아니라 **반출**에 있기 때문이다.
 *
 * 남기는 것은 형식·대상·건수뿐이다. 반출된 데이터의 내용도, 검색 조건도 남기지 않는다
 * (목적지·이름이 검색어에 들어갈 수 있다).
 *
 * ## 절대 내보내기를 막지 않는다
 * 기록 호출은 fire-and-forget이다. 감사 쓰기가 실패했다고 사용자가 받아야 할 파일을
 * 막으면 손실이 훨씬 크고, 사용자가 손쓸 수 있는 것도 없다.
 *
 * 다만 **조용히 포기하지도 않는다.** 응답이 늦거나 끊기면 `callWithRetry`가 짧은 백오프로
 * 다시 부른다 — 반출 기록은 고시 제16조가 요구하는 항목이라 유실되면 점검에 구멍이 난다.
 * 같은 exportId를 재사용하므로 재시도가 중복 기록을 만들지 않는다.
 */
import { callWithRetry, isTransientCallableError } from '../callableRetry';
import { captureError } from '../sentry';

/** 서버(recordExport.ts)의 DATASETS 화이트리스트와 1:1로 맞춘다 */
export type ExportDataset =
    | 'driveLogs'
    | 'dailyLogs'
    | 'fuelLogs'
    | 'hipassCharges'
    | 'maintenance'
    /** 접속기록 자체의 반출 — 점검 결과 보관용. IP를 담으므로 이것도 개인정보 반출이다 */
    | 'auditLogs';

export type ExportFormat = 'excel' | 'pdf';

/** 서버의 EXPORT_ID_PATTERN(`[A-Za-z0-9_-]{8,64}`)을 만족하는 난수 */
function newExportId(): string {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 반출 1건을 기록한다. 호출부는 await하지 않아도 된다.
 *
 * @param format   생성한 파일 형식
 * @param dataset  반출 대상 데이터셋
 * @param recordCount 반출 건수 (내용이 아니라 규모만 남긴다)
 */
export function recordExport(format: ExportFormat, dataset: ExportDataset, recordCount: number): void {
    // 반출 식별자는 **시도마다가 아니라 반출마다** 하나다. 재시도가 같은 문서를 덮어쓰므로
    // 응답이 늦어 다시 부른 것이 두 번 반출한 것으로 기록되지 않는다.
    const exportId = newExportId();

    void callWithRetry('recordExport', { format, dataset, recordCount, exportId }).catch((err) => {
        if (isTransientCallableError(err)) {
            // 네트워크가 끊겼거나 응답이 돌아오지 않은 경우. 재시도까지 실패했다면
            // 사용자도 우리도 더 할 수 있는 것이 없다 — Sentry에 올려도 조치로 이어지지 않는다.
            console.warn('[recordExport] 반출 기록 실패 (네트워크)', err);
            return;
        }
        captureError(err, { context: 'recordExport', dataset, format });
    });
}
