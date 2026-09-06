/**
 * syncFailureNotice — 오프라인 큐에서 폐기된(= 서버에 반영되지 못한) 기록을 사용자에게 알린다.
 *
 * flushQueue는 서비스워커에서도 돌기 때문에 폐기 시점에 토스트를 띄울 수 없다(SW에는 화면이 없다).
 * 그래서 큐는 폐기분을 IndexedDB의 failed-store에 남겨만 두고, 화면이 있는 이 모듈이
 * 다음 세 시점에 그걸 읽어 알린다:
 *
 *   1) 앱 시작 — 지난 세션에 SW가 폐기한 건
 *   2) 온라인 복귀 후 flush 완료 — 방금 폐기된 건 (flushQueue를 await해서 순서를 보장)
 *   3) 화면 복귀(visibilitychange) — 앱이 백그라운드인 동안 SW가 폐기한 건
 *
 * 이 모듈은 화면(토스트)에 의존하므로 SW 번들에 들어가면 안 된다 — sw.ts는 syncQueue만 import한다.
 */
import { peekFailedRecords, clearFailedRecords, flushQueue, type FailedRecord } from './syncQueue';
import { notifyUser } from '../notify';

/** 큐에 적재되는 컬렉션 → 사용자가 읽는 이름 (enqueue 호출부와 1:1) */
const COLLECTION_LABEL: Record<string, string> = {
    driveLogs: '운행일지',
    reservations: '예약',
};

function labelOf(collection: string): string {
    return COLLECTION_LABEL[collection] ?? collection;
}

/**
 * 폐기 사유별 안내 문구.
 * - permanent: 권한 거부 등 다시 시도해도 결과가 같은 오류 → 재작성 외에 방법이 없다
 * - retry-exhausted: 통신 문제로 5회까지 재시도했으나 실패 → 역시 재작성이 필요하다
 *
 * 두 경우 모두 "다시 입력해야 한다"는 행동을 분명히 말한다. 유실 사실만 알리고
 * 무엇을 해야 하는지 말하지 않으면 운전자는 그대로 지나간다.
 */
export function buildFailureMessage(records: FailedRecord[]): string {
    const counts = new Map<string, number>();
    for (const r of records) {
        const label = labelOf(r.collection);
        counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const summary = Array.from(counts.entries())
        .map(([label, count]) => `${label} ${count}건`)
        .join(', ');

    const hasPermanent = records.some((r) => r.reason === 'permanent');
    const cause = hasPermanent
        ? '권한이 없거나 이미 변경된 기록이라'
        : '통신 오류가 반복되어';

    // 무엇을 잃었는지 함께 적는다. "다시 입력해 주세요"만으로는 다시 입력할 수가 없다 —
    // 차에서 내린 뒤에는 계기판 숫자를 기억으로 복원할 방법이 없기 때문이다.
    // 큐는 payload를 그대로 들고 있었는데 지금까지 건수만 세고 버렸다.
    // 길이를 묶는다. 오래 오프라인이던 사용자는 폐기가 여러 건 쌓이는데, 전부 이으면
    // 15초짜리 토스트에 수백 자가 들어가 정작 읽히지 않는다.
    const MAX_DETAILS = 3;
    const all = records.map(describeRecord).filter(Boolean);
    const shown = all.slice(0, MAX_DETAILS);
    const rest = all.length - shown.length;
    const detailText = shown.length > 0
        ? ` (${shown.join(' / ')}${rest > 0 ? ` 외 ${rest}건` : ''})`
        : '';

    return `저장하지 못한 내용이 있습니다 — ${summary}${detailText}. ${cause} 서버에 반영되지 않았습니다. 번거롭지만 다시 입력해 주세요.`;
}

/**
 * 폐기된 기록 한 건을 사용자가 알아볼 수 있는 한 줄로 만든다.
 *
 * 다시 입력하려면 **계기판 숫자**가 있어야 한다 — 날짜·목적지는 기억나도 그건 안 난다.
 * 값이 없는 조각은 빼고, 남는 것이 없으면 빈 문자열을 돌려준다(빈 괄호가 뜨지 않게).
 */
export function describeRecord(record: FailedRecord): string {
    const data = (record.data ?? {}) as Record<string, unknown>;
    // 큐가 센티널을 문자열 마커로 바꿔 저장한다(syncQueue의 toStorable). 오프라인 **수정**은
    // 당일 운행의 startDate를 deleteField()로 지우므로 그 자리에 `__syncQueue.deleteField__`가
    // 들어 있다 — 거르지 않으면 사용자에게 내부 문자열이 날짜라고 보여진다.
    const str = (v: unknown) => {
        if (typeof v !== 'string') return undefined;
        const t = v.trim();
        return t && !t.startsWith('__syncQueue.') ? t : undefined;
    };
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

    const parts: string[] = [];
    const when = str(data.startDate) ?? str(data.date) ?? formatQueuedDate(data.timestamp);
    if (when) parts.push(when);
    const where = str(data.destination);
    if (where) parts.push(where);

    const startKm = num(data.startKm);
    const endKm = num(data.endKm);
    if (startKm !== undefined && endKm !== undefined) {
        parts.push(`${startKm.toLocaleString('ko-KR')}→${endKm.toLocaleString('ko-KR')}km`);
    }
    return parts.join(' · ');
}

/**
 * 큐에 실린 `timestamp`를 'YYYY-MM-DD'로 만든다.
 *
 * **운행일지에는 `date` 필드가 없다.** `buildLogData`가 만드는 것은 `timestamp`(Date)뿐이고
 * `date`는 옛 문서에만 남아 있는 레거시다. 그것만 찾으면 날짜는 사실상 언제나 비어,
 * "날짜를 알려 준다"는 말이 거짓이 된다. Date는 structuredClone을 그대로 통과하므로
 * 큐에서도 Date로 남아 있다.
 */
export function formatQueuedDate(value: unknown): string | undefined {
    const d = value instanceof Date ? value : undefined;
    if (!d || Number.isNaN(d.getTime())) return undefined;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 폐기 기록이 있으면 사용자에게 알린다. 알린 항목은 큐에서 비워지므로 같은 유실을 두 번 알리지 않는다.
 * @returns 알린 건수(없으면 0)
 */
/**
 * 진행 중인 보고를 붙잡아 둔다. 세 트리거(online·visibilitychange·앱 시작)는 겹쳐서 발화한다 —
 * 잠금 화면을 풀며 통신이 돌아오면 두 개가 같이 뜬다. 각자 읽어 각자 알리면 **똑같은 15초짜리
 * 오류 토스트가 두 번** 뜬다. flushQueue가 쓰는 방식 그대로, 같은 Promise를 돌려준다.
 */
let reporting: Promise<number> | null = null;

export function reportFailedSync(): Promise<number> {
    if (reporting) return reporting;
    reporting = doReportFailedSync().finally(() => { reporting = null; });
    return reporting;
}

async function doReportFailedSync(): Promise<number> {
    try {
        // **읽고, 알리고, 그다음에 비운다.** 예전에는 비우면서 읽어, 알리기 직전에 화면이
        // 닫히면 기록은 사라지고 사용자는 끝내 듣지 못했다.
        const records = await peekFailedRecords();
        if (records.length === 0) return 0;
        // 유실 안내는 놓치면 의미가 없으므로 일반 토스트보다 길게 띄운다.
        notifyUser(buildFailureMessage(records), 'error', 15000);
        // 방금 알린 것만 지운다 — 그 사이 서비스워커가 밀어 넣은 폐기는 남겨 다음에 알린다.
        await clearFailedRecords(records.map((r) => r.id));
        return records.length;
    } catch (error) {
        console.error('[SyncFailureNotice] 폐기 기록 확인 실패', error);
        return 0;
    }
}

let registered = false;

/** 앱 시작 시 1회 호출 — 위 세 시점에 폐기 기록을 확인하도록 등록한다. */
export function registerSyncFailureNotice(): void {
    if (registered || typeof window === 'undefined') return;
    registered = true;

    // 온라인 복귀: flush가 끝나야 폐기 여부가 확정된다. flushQueue는 진행 중이면
    // 같은 Promise를 돌려주므로, registerReconnectFlush가 이미 시작한 flush에 그대로 올라탄다.
    window.addEventListener('online', () => {
        void flushQueue().then(() => reportFailedSync());
    });

    // 화면 복귀: 백그라운드 동안 SW가 폐기한 건을 잡는다.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void reportFailedSync();
    });

    // 앱 시작: 지난 세션에 폐기된 건을 잡는다.
    void reportFailedSync();
}
