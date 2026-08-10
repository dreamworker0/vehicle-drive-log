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
import { drainFailedRecords, flushQueue, type FailedRecord } from './syncQueue';
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

    return `저장하지 못한 내용이 있습니다 — ${summary}. ${cause} 서버에 반영되지 않았습니다. 번거롭지만 다시 입력해 주세요.`;
}

/**
 * 폐기 기록이 있으면 사용자에게 알린다. 알린 항목은 큐에서 비워지므로 같은 유실을 두 번 알리지 않는다.
 * @returns 알린 건수(없으면 0)
 */
export async function reportFailedSync(): Promise<number> {
    try {
        const records = await drainFailedRecords();
        if (records.length === 0) return 0;
        // 유실 안내는 놓치면 의미가 없으므로 일반 토스트보다 길게 띄운다.
        notifyUser(buildFailureMessage(records), 'error', 15000);
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
