/**
 * syncQueue — 오프라인·지연 쓰기의 **확인 장부** (저장은 Firestore가 한다)
 *
 * ## 무엇이 바뀌었나 (2026-11-11)
 * 예전 이 모듈은 오프라인 쓰기를 IndexedDB에 쌓았다가 연결이 돌아오면 **직접 다시 보냈다**.
 * 그런데 같은 쓰기를 Firestore SDK도 영구 캐시(persistentLocalCache)에 남겨 두고 스스로 다시
 * 보낸다. 한 기록이 두 번 올라가면서 —
 *   - 새 기록의 재생(setDoc)이 문서를 통째로 다시 써 작성 시각이 바뀌고, 그 사이 서버가 고친 값이 되돌아갔다,
 *   - 일시 오류로 최대 31분 미뤄진 재생이 그 사이의 최신 수정을 덮을 수 있었다,
 *   - 이미 지워진 문서의 삭제 재생이 권한 거부로 떨어져 **반영된 기록을 "유실"로 안내**할 수 있었다.
 * 정작 이 큐가 지켜 주는 경우는 거의 없었다 — SDK 캐시와 같은 IndexedDB에 살아서, SDK가 못 쓰는
 * 기기에서는 이 큐도 같이 못 썼다. 반대로 "온라인인데 통신이 안 되는"(지하 주차장) 저장은
 * `navigator.onLine`만 보고 큐에 넣지 않아, 로그아웃이 SDK 캐시를 지우면 경고 없이 사라졌다.
 *
 * 그래서 **저장은 SDK 한 경로로** 두고, 이 모듈은 "아직 서버 확인을 받지 못한 쓰기"의 장부만 맡는다.
 *   1) 쓰기마다(온라인이든 오프라인이든) 장부에 적는다 — `trackWrite`
 *   2) 같은 화면에서 SDK가 서버 확인을 받으면 지운다. 서버가 거부하면 유실 기록(failed-store)으로 옮긴다
 *   3) 확인 전에 화면이 닫혔으면, 다음 실행에서 SDK 전송이 끝나기를 기다린 뒤 **서버에 실제로 있는지**
 *      확인하고 지운다. 없으면 유실 기록으로 옮긴다 — `reconcileLedger`
 * 장부 건수는 "미전송 N건" 배너와 로그아웃 확인에 그대로 쓰인다.
 *
 * 옛 버전이 남긴 큐 항목(내용이 실린 기록)도 같은 장부로 읽어 3)으로 처리한다 — 다시 보내지 않는다.
 * 그 쓰기도 SDK 캐시에 함께 남아 있어 SDK가 보낸다.
 */
import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { doc, getDocFromServer, waitForPendingWrites, FieldValue, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';

export interface SyncData {
    type: 'CREATE' | 'UPDATE' | 'DELETE';
    collection: string;
    docId: string;
    /** 쓴 내용 — 다시 보내지 않는다. 유실 안내에 "무엇을 잃었는지"(날짜·계기판)를 적는 데만 쓴다 */
    data: Record<string, unknown> | null;
}

/**
 * 유실 사유 — 사용자 안내 문구를 가르는 유일한 기준
 * - permanent: 서버가 쓰기를 거부했다(권한 등)
 * - not-applied: 다음 실행에서 확인해 보니 서버에 없다
 * - retry-exhausted: 옛 버전의 재시도 소진 기록 (새로 만들지 않지만, 기기에 남은 기록을 읽을 수 있어야 한다)
 */
export type FailedReason = 'permanent' | 'not-applied' | 'retry-exhausted';

/** 서버에 반영되지 못한 쓰기의 보관 형태 */
export interface FailedRecord extends SyncData {
    id?: number;
    /** 장부에 적은 시각 */
    timestamp: number;
    /** 유실로 판정한 시각 */
    failedAt: number;
    reason: FailedReason;
    /** Firestore 오류 코드 (없으면 '') */
    code: string;
}

/**
 * 장부 한 줄. 스토어 이름(`sync-store`)과 모양은 옛 큐 그대로 둔다 — 기기에 남은 옛 항목을
 * 업그레이드 없이 같은 장부로 읽기 위해서다(iOS Safari에서 IDB 버전 올리기는 실패가 잦다).
 * `retryCount`·`lastAttemptAt`은 옛 항목에만 있다.
 */
type LedgerRecord = SyncData & { id?: number; timestamp: number; retryCount?: number; lastAttemptAt?: number };

interface SyncDB extends DBSchema {
    'sync-store': {
        key: number;
        value: LedgerRecord;
        indexes: { 'by-timestamp': number };
    };
    // 유실 기록. 이 모듈은 화면(토스트)에 의존하지 않으므로 유실 사실을 여기에 남겨 두고,
    // 페이지 컨텍스트(syncFailureNotice)가 확인 뒤·다음 기회에 읽어서 사용자에게 알린다.
    'failed-store': {
        key: number;
        value: FailedRecord;
        indexes: { 'by-failedAt': number };
    };
}

let dbPromise: Promise<IDBPDatabase<SyncDB>> | null = null;

export function getSyncDB() {
    if (!dbPromise) {
        // v2: 'failed-store' 추가. 기존 사용자의 v1 DB는 upgrade로 스토어만 덧붙는다
        // (sync-store의 미전송 항목은 그대로 보존된다).
        // terminated는 열기가 끝난 뒤에야 불리므로 그때는 cached가 채워져 있다
        let cached: Promise<IDBPDatabase<SyncDB>> | null = null;
        cached = openDB<SyncDB>('sync-db', 2, {
            upgrade(database) {
                if (!database.objectStoreNames.contains('sync-store')) {
                    const store = database.createObjectStore('sync-store', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('by-timestamp', 'timestamp');
                }
                if (!database.objectStoreNames.contains('failed-store')) {
                    const store = database.createObjectStore('failed-store', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('by-failedAt', 'failedAt');
                }
            },
            // 브라우저가 연결을 **우리 몰래** 닫았다 — 캐시를 비워 다음 호출이 새로 열게 한다.
            // iOS Safari는 앱이 백그라운드에 있는 동안 IDB 연결을 끊는다. 이 콜백이 없으면 죽은
            // 연결을 세션 내내 들고 있어 화면 복귀 확인이 바로 그 연결로 읽다 실패했다
            // (withSyncDB 주석 참고). 그사이 다른 호출이 새 연결을 이미 열었으면 건드리지 않는다.
            terminated() {
                if (dbPromise === cached) dbPromise = null;
            },
        }).catch((error) => {
            // **실패한 Promise를 캐시에 남기지 않는다.** iOS Safari는 IDB 백엔드가 일시적으로
            // 죽으면 여는 것부터 거부한다(`UnknownError: An internal error was encountered in
            // the Indexed Database server`). 그 거부를 계속 들고 있으면 기기가 회복된 뒤에도
            // **이 세션 내내 큐가 죽은 채로 남는다** — 미전송 건수는 0으로 보이고
            // (getPendingCount의 catch), 이후 오프라인 쓰기는 전부 적재에 실패한다.
            // 비워 두면 다음 호출이 다시 연다.
            dbPromise = null;
            throw error;
        });
        dbPromise = cached;
    }
    return dbPromise;
}

/**
 * 이미 닫히는 중인 연결로 트랜잭션을 열려 했다 — `InvalidStateError: Failed to execute
 * 'transaction' on 'IDBDatabase': The database connection is closing.`
 */
function isConnectionClosing(error: unknown): boolean {
    const message = (error as { message?: unknown } | null)?.message;
    return typeof message === 'string' && message.includes('database connection is closing');
}

/**
 * 캐시된 연결로 `fn`을 실행하고, **그 연결이 닫혀 있었으면 새로 열어 한 번만 다시 한다.**
 *
 * iOS Safari는 앱이 백그라운드로 가면 IDB 연결을 끊는다. 그 사실(`close` 이벤트 → 위의
 * `terminated`)이 화면 복귀 뒤 우리 호출보다 늦게 도착할 수 있어, terminated만으로는 첫 호출이
 * 여전히 죽은 연결을 쓴다. 화면 복귀는 장부 확인 계기(registerLedgerReconcile ④)라 정확히 그
 * 순간에 읽기가 실패해 처리되지 않은 거부로 올라왔다(Sentry JAVASCRIPT-REACT-6N, iOS 18.7).
 * 같은 죽은 연결로 장부 기록이 실패하면 **그 쓰기가 미전송 건수와 로그아웃 확인에서 빠진다** — 이쪽이 더 크다.
 *
 * 다시 하는 것은 한 번뿐이다. 새로 연 연결마저 닫히는 중이면 이 기기의 IDB를 지금 쓸 수 없는
 * 것이므로(IDB_UNUSABLE_MESSAGES) 호출자에게 넘긴다.
 *
 * `fn`은 다시 실행돼도 안전한 IDB 작업만 담는다 — Firestore 쓰기처럼 되돌릴 수 없는 일을
 * 넣으면 그것까지 두 번 한다.
 */
async function withSyncDB<T>(fn: (database: IDBPDatabase<SyncDB>) => Promise<T>): Promise<T> {
    const stale = getSyncDB();
    try {
        return await fn(await stale);
    } catch (error) {
        if (!isConnectionClosing(error)) throw error;
        // 다른 호출이 이미 새로 열었으면 그것을 쓴다
        if (dbPromise === stale) dbPromise = null;
        return fn(await getSyncDB());
    }
}

/**
 * serverTimestamp() 센티널의 IndexedDB 저장용 마커.
 *
 * FieldValue 센티널은 클래스 인스턴스라 structuredClone(IndexedDB 저장)을 거치면
 * 프로토타입이 소실된다. 장부는 내용을 다시 보내지 않으므로 복원하지 않는다 — 유실 안내가
 * 이 문자열을 날짜·값으로 보여 주지 않도록 거르는 데 쓴다(syncFailureNotice.describeRecord).
 */
export const SERVER_TIMESTAMP_MARKER = '__syncQueue.serverTimestamp__';
/**
 * 필드 삭제 센티널 마커.
 *
 * 예전에는 FieldValue를 전부 serverTimestamp로 뭉뚱그렸다 — 오프라인 쓰기 경로에 그것뿐이라는
 * 전제였다. 운행일지 수정이 `deleteField()`로 출발일을 지우기 시작하면서 그 전제가 깨졌고,
 * (옛 큐는 이것을 serverTimestamp로 뭉뚱그려, 재생 때 날짜 자리에 타임스탬프가 박혔다.)
 */
export const DELETE_FIELD_MARKER = '__syncQueue.deleteField__';

/**
 * FieldValue 센티널을 종류별 마커로 가른다.
 *
 * 한동안 이 자리는 "오프라인 쓰기 경로의 FieldValue는 serverTimestamp뿐"이라는 전제 위에서
 * 전부 하나로 뭉뚱그렸다. 운행일지 수정이 `deleteField()`를 쓰기 시작하면서 그 전제가 깨졌고,
 * 재생될 때 **날짜 문자열 자리에 타임스탬프가 박혔다.** 장부는 다시 보내지 않으므로 이제 마커는
 * 유실 안내에서 걸러 낼 표식일 뿐이다. 모르는 센티널(`increment()` 등)도 같은 접두어의 마커로 남겨,
 * 안내 문구에 내부 객체가 새지 않게 한다.
 *
 * 판별은 Firestore가 공개하는 `_methodName`으로 한다(실물 번들에서 이름이 유지되는 것을 확인했다).
 */
function sentinelMarker(value: FieldValue): string {
    const method = (value as unknown as { _methodName?: string })._methodName;
    if (method === 'deleteField') return DELETE_FIELD_MARKER;
    if (method === 'serverTimestamp') return SERVER_TIMESTAMP_MARKER;
    // 장부 기록이 실패하면 그 쓰기가 미전송 건수에서 빠진다 — 던지지 않고 표식으로 남긴다
    return `__syncQueue.${method ?? 'unknown'}__`;
}

/**
 * 평범한 객체(`{}` 리터럴·JSON 모양)인가 — 재귀해 들어갈 대상.
 *
 * `Object.getPrototypeOf(v) === Object.prototype`으로 비교하면 **다른 영역(realm)에서 만든 객체**를
 * 놓친다. IndexedDB가 structured clone으로 돌려준 값은 그 저장소 구현의 영역에 속할 수 있어서,
 * 옛 큐는 그 경우 저장해 둔 마커를 복원하지 못한 채 재생했다(Vitest vmThreads + fake-indexeddb에서 실측,
 * 2026-10-17). 프로토타입 사슬이 "어느 영역이든 Object.prototype 하나 → null"이면 평범한 객체로 본다.
 * FieldValue·Timestamp·Date 같은 클래스 인스턴스는 사슬이 한 단계 더 길어 걸러진다.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object') return false;
    const proto = Object.getPrototypeOf(value);
    return proto === null || Object.getPrototypeOf(proto) === null;
}

/**
 * IndexedDB에 안전하게 저장 가능한 형태로 변환한다.
 * - FieldValue 센티널 → 종류별 마커 문자열 (sentinelMarker 참고)
 * - Firestore Timestamp → Date (Timestamp도 클래스라 clone 시 프로토타입이 소실되지만,
 *   Date는 structuredClone을 그대로 통과하고 Firestore가 timestamp로 기록한다)
 */
function toStorable(value: unknown): unknown {
    if (value instanceof FieldValue) return sentinelMarker(value);
    if (value instanceof Timestamp) return value.toDate();
    if (Array.isArray(value)) return value.map(toStorable);
    if (isPlainObject(value)) {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toStorable(v)]));
    }
    return value;
}


// ── 장부 ──

/**
 * 호출부가 결과를 직접 기다리는 쓰기(온라인 저장)는 이 시간 안에 거부되면 **호출부가 이미 오류를
 * 보여 줬다**고 본다 — 유실 기록으로 한 번 더 알리지 않는다. 저장 화면은 8초 뒤 "네트워크 지연"으로
 * 안내하고 손을 놓으므로(useDriveLogSubmit의 runWithRetry), 그 뒤에 온 거부는 아무도 보지 못했다.
 */
const CALLER_WAIT_MS = 10_000;

/** 저장 경로가 장부 기록을 기다리는 상한 (trackWrite 주석) */
const LEDGER_WAIT_MS = 1_500;

/**
 * 장부에 남은 줄을 "지난 실행의 것"으로 보기 위한 최소 나이.
 * 다른 탭이 방금 쓴 줄을 이 탭이 확인하려 들면, 그 탭의 SDK가 아직 보내기 전이라 "서버에 없음"으로
 * 잘못 판정할 수 있다. 1분이면 정상 저장은 끝났다.
 */
const ORPHAN_MIN_AGE_MS = 60_000;

/** SDK 전송 완료를 기다리는 상한 — 넘으면 이번에는 확인하지 않고 다음 계기에 다시 한다 */
const PENDING_WRITES_WAIT_MS = 30_000;

/** 확인에 쓸 수 없는 오류 — 이 줄은 확인할 방법이 없으므로 지우기만 한다(소속이 바뀐 사용자 등) */
const UNVERIFIABLE_CODES = new Set(['permission-denied', 'not-found']);

/** 이 화면에서 적고 아직 결과를 기다리는 줄 — 확인(reconcile) 대상에서 뺀다 */
const liveIds = new Set<number>();

/**
 * 장부가 바뀌었음을 화면(usePendingSyncCount)에 알리는 이벤트.
 * 배너는 원래 오프라인 전환·연결 복귀·화면 복귀 때만 건수를 다시 셌다 — 그래서 "온라인인데 통신이
 * 안 되는" 곳에서 저장한 기록은 배너에 잡히지 않았다. `detail.added`면 새로 적힌 것이다.
 */
export const LEDGER_CHANGE_EVENT = 'sync-ledger-change';

function notifyLedgerChange(added: boolean): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(LEDGER_CHANGE_EVENT, { detail: { added } }));
}

function errorCode(error: unknown): string {
    const code = (error as { code?: unknown } | null)?.code;
    return typeof code === 'string' ? code.replace(/^firestore\//, '') : '';
}

async function recordFailure(record: SyncData & { timestamp: number }, reason: FailedReason, code: string): Promise<void> {
    try {
        await withSyncDB((database) => database.add('failed-store', {
            type: record.type,
            collection: record.collection,
            docId: record.docId,
            data: record.data,
            timestamp: record.timestamp,
            failedAt: Date.now(),
            reason,
            code,
        }));
    } catch (error) {
        console.error('[SyncLedger] 유실 기록 저장 실패', error);
    }
}

async function removeLine(id: number | undefined): Promise<void> {
    if (id === undefined) return;
    liveIds.delete(id);
    try {
        await withSyncDB((database) => database.delete('sync-store', id));
        notifyLedgerChange(false);
    } catch (error) {
        // 지우지 못한 줄은 다음 실행에서 확인 대상으로 남는다 — 서버에 있으면 그때 지워진다
        console.warn('[SyncLedger] 장부 정리 실패 — 다음 실행에서 다시 확인한다', error);
    }
}

/**
 * 쓰기 한 건을 장부에 적고, SDK의 결과에 따라 정리한다.
 *
 * **저장을 대신하지 않는다.** `write`는 호출부가 이미 시작한 Firestore 쓰기(setDoc·updateDoc·deleteDoc)다.
 * 이 함수는 결과를 기다리지 않고 장부에 적는 데까지만 기다린다 — 오프라인이면 결과가 한참 뒤에 온다.
 *
 * 실패하지 않는다. IndexedDB를 쓸 수 없는 기기에서는 장부 없이 넘어간다(그 기기는 SDK 캐시도
 * 내구성이 없어, 저장 화면이 따로 "확인이 필요하다"고 안내한다 — hasDurableLocalCache).
 *
 * 삭제(DELETE)의 거부는 유실로 기록하지 않는다. 유실 안내는 "다시 입력해 주세요"라고 말하는데,
 * 지우지 못한 기록은 다시 입력할 것이 아니라 화면에 그대로 남아 있다.
 *
 * **장부 기록은 최대 LEDGER_WAIT_MS만 기다린다.** 온라인 저장도 이 함수를 거치는데, iOS Safari는
 * IndexedDB가 멈추거나 느려지는 일이 있다(withSyncDB 주석). 장부 때문에 저장이 멈추면 안 되므로
 * 상한을 넘기면 돌아가고, 기록과 정리는 뒤에서 이어 간다.
 */
export function trackWrite(
    type: SyncData['type'],
    collectionName: string,
    docId: string,
    data: Record<string, unknown> | null,
    write: Promise<unknown>,
    { callerAwaits }: { callerAwaits: boolean },
): Promise<void> {
    const startedAt = Date.now();
    // 거부 처리기를 **바로** 단다. 장부 기록을 기다린 뒤에 달면, 그 사이에 거부된 쓰기가
    // 처리되지 않은 거부로 잡힌다(Sentry 오탐).
    const outcome = write.then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
    );

    let stored: Record<string, unknown> | null = null;
    const recorded = (async (): Promise<number | undefined> => {
        try {
            stored = data ? (toStorable(data) as Record<string, unknown>) : null;
            const line: LedgerRecord = { type, collection: collectionName, docId, data: stored, timestamp: startedAt };
            const id = await withSyncDB((database) => database.add('sync-store', line));
            liveIds.add(id);
            notifyLedgerChange(true);
            return id;
        } catch (error) {
            console.warn('[SyncLedger] 장부에 적지 못했다 — 이 쓰기는 미전송 건수에 잡히지 않는다', error);
            return undefined;
        }
    })();

    // 기록이 끝난 뒤에 결과를 반영한다 — 결과가 먼저 와도 지울 줄이 생긴 다음에 지운다
    void recorded.then(async (id) => {
        const result = await outcome;
        if (!result.ok) {
            const seenByCaller = callerAwaits && Date.now() - startedAt < CALLER_WAIT_MS;
            if (!seenByCaller && type !== 'DELETE') {
                console.error(`[SyncLedger] ${collectionName}/${docId} 서버가 거부했다`, result.error);
                await recordFailure(
                    { type, collection: collectionName, docId, data: stored, timestamp: startedAt },
                    'permanent',
                    errorCode(result.error),
                );
            }
        }
        await removeLine(id);
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
        recorded.then(() => undefined),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, LEDGER_WAIT_MS); }),
    ]).finally(() => clearTimeout(timer));
}

/**
 * 장부를 전부 비운다.
 * 장부에는 사용자·기관 식별자가 없으므로, 로그아웃 시 비우지 않으면 공용 기기의 다음 사용자에게
 * 앞사람의 미전송 건수·유실 안내가 뜬다 (2026-07-10 감사 #8). 로그아웃은 SDK 캐시도 함께 지운다.
 */
export async function clearQueue() {
    await withSyncDB(async (database) => {
        await database.clear('sync-store');
        await database.clear('failed-store');
    });
}

/**
 * 아직 서버 확인을 받지 못한 쓰기 수. "미전송 N건" 배너와 로그아웃 확인에 쓴다.
 *
 * IDB를 열지 못하는 환경(사파리 프라이빗 모드 등)에서는 0을 돌려준다 — 표시용 값이라
 * 실패를 위로 던져 배너를 깨뜨릴 이유가 없다.
 */
export async function getPendingCount(): Promise<number> {
    try {
        return await withSyncDB((database) => database.count('sync-store'));
    } catch {
        return 0;
    }
}

/**
 * 유실 기록을 **읽기만** 한다. 비우지 않는다.
 *
 * 읽기와 삭제를 갈라 둔 이유는 `clearFailedRecords`에 적어 두었다 — 알리기 전에 지우면
 * 유실을 알리는 장치가 유실되고, 통째로 비우면 사이에 들어온 유실이 함께 사라진다.
 */
export async function peekFailedRecords(): Promise<FailedRecord[]> {
    return withSyncDB((database) => database.getAll('failed-store'));
}

/**
 * 사용자에게 **알린 기록만** 골라 지운다. 같은 유실을 두 번 알리지 않기 위해서다.
 *
 * 예전에는 읽으면서 함께 비웠다(`drainFailedRecords`). 읽은 직후 화면이 닫히면 기록은
 * 사라지고 사용자는 끝내 듣지 못했다 — 유실을 알리는 장치가 유실되는 모양이었다.
 *
 * 스토어를 통째로 비워서도 안 된다. 읽은 뒤 지우기까지 사이에 다른 탭이 새 유실을
 * 밀어 넣을 수 있는데, 그것까지 함께 지워지면 **한 번도 알려지지 않은 채 사라진다** —
 * 이 함수가 막으려던 바로 그 일이다. 그래서 id로 지정해 지운다.
 */
export async function clearFailedRecords(ids: Array<number | undefined>): Promise<void> {
    await withSyncDB(async (database) => {
        const tx = database.transaction('failed-store', 'readwrite');
        await Promise.all([
            ...ids.filter((id): id is number => typeof id === 'number').map((id) => tx.store.delete(id)),
            tx.done,
        ]);
    });
}

// 동시 확인 방지 — 'online'·앱 시작·SW 메시지·화면 복귀가 겹칠 수 있다.
//
// 불리언이 아니라 진행 중인 Promise를 붙잡아 둔다. 겹친 호출이 즉시 반환해 버리면
// "확인이 끝난 뒤 유실분을 안내"하려는 호출자(syncFailureNotice)가 아직 시작도 안 한
// 장부를 보고 '유실 없음'으로 판단한다. 같은 Promise를 돌려주면 누가 부르든 같은 완료 시점을 본다.
let reconciling: Promise<void> | null = null;

export function reconcileLedger(): Promise<void> {
    if (reconciling) return reconciling;
    reconciling = runReconcile().finally(() => { reconciling = null; });
    return reconciling;
}

/**
 * 이 기기에서 **IndexedDB 자체를 쓸 수 없을 때** 나오는 문구들.
 *
 * WebKit은 IDB 백엔드를 잃으면 여는 것부터 이 문구로 거부한다(iOS Safari). 그런 기기에서
 * 확인이 할 수 있는 일은 없다 — 다음 계기에 다시 시도하는 것 말고는.
 *
 * **여기 없는 실패는 삼키지 않는다.** 장부가 영영 비지 않는 종류의 결함('미전송 N건'이 계속 남는다)은
 * 환경이 아니라 우리 문제이고, 보이지 않으면 고칠 수 없다.
 */
const IDB_UNUSABLE_MESSAGES = [
    'An internal error was encountered in the Indexed Database server',
    'Connection to Indexed Database server lost',
    // withSyncDB가 새 연결로 한 번 다시 했는데도 닫히는 중이었다 — 지금은 기기가 IDB를 내주지 않는다
    'database connection is closing',
];

function isIdbUnusable(error: unknown): boolean {
    const message = (error as { message?: unknown } | null)?.message;
    const text = typeof message === 'string' ? message : String(error ?? '');
    return IDB_UNUSABLE_MESSAGES.some((known) => text.includes(known));
}

/**
 * 결과를 기다리지 않는 계기(`online`·앱 시작)에서 쓰는 확인 — **IDB를 못 쓰는 기기에서만** 실패를 삼킨다.
 *
 * 부르는 쪽이 `void`로 부르므로, IDB가 통째로 실패하는 기기에서는 거부가 곧 처리되지 않은
 * 프라미스 거부가 되어 스택 없는 오류로 Sentry에 올라왔다(JAVASCRIPT-REACT-6H, iOS Safari).
 * 그 밖의 실패는 그대로 드러낸다(isIdbUnusable 주석 참고).
 */
export function reconcileLedgerQuietly(): Promise<void> {
    return reconcileLedger().catch((error) => {
        if (!isIdbUnusable(error)) throw error;
        console.warn('[SyncLedger] IDB를 쓸 수 없어 확인을 건너뛴다 — 다음 계기에 다시 시도한다', error);
    });
}

/**
 * 지난 실행에서 확인을 받지 못한 줄을 서버와 대조한다.
 *
 * 1) 오프라인이면 아무것도 하지 않는다 — 서버에 물을 수 없다.
 * 2) SDK가 남은 쓰기를 다 보낼 때까지 기다린다(`waitForPendingWrites`). 보내기 전에 물으면 "없다"가
 *    정상이다. 상한(30초)을 넘으면 이번에는 그만두고 다음 계기에 다시 한다.
 * 3) 줄마다 서버에서 문서를 읽는다(캐시가 아니라 서버 — 캐시에는 보내지 못한 쓰기가 보인다).
 *    새 기록·수정은 문서가 있으면, 삭제는 없으면 반영된 것으로 본다. 수정의 **내용**까지는 대조하지
 *    않는다 — 그 사이 다른 사람이 고쳤을 수 있어, 다르다고 유실이라 말하면 거짓 안내가 된다.
 * 4) 반영되지 않은 새 기록·수정은 유실 기록으로 옮긴다. 확인한 줄은 지운다.
 *
 * 통신 오류로 읽기가 실패하면 그 자리에서 멈추고 남은 줄은 다음 계기에 다시 확인한다.
 */
async function runReconcile(): Promise<void> {
    const lines = await withSyncDB((database) => database.getAll('sync-store'));
    const now = Date.now();
    const orphans = lines.filter((line) =>
        line.id !== undefined && !liveIds.has(line.id) && now - line.timestamp >= ORPHAN_MIN_AGE_MS);
    if (orphans.length === 0) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = await Promise.race([
        waitForPendingWrites(db).then(() => true, () => false),
        new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), PENDING_WRITES_WAIT_MS); }),
    ]);
    clearTimeout(timer);
    if (!settled) return;

    for (const line of orphans) {
        let exists: boolean;
        try {
            exists = (await getDocFromServer(doc(db, line.collection, line.docId))).exists();
        } catch (error) {
            if (UNVERIFIABLE_CODES.has(errorCode(error))) {
                await removeLine(line.id);
                continue;
            }
            console.warn('[SyncLedger] 서버 확인 실패 — 남은 줄은 다음 계기에 다시 확인한다', error);
            return;
        }
        const applied = line.type === 'DELETE' ? !exists : exists;
        if (!applied && line.type !== 'DELETE') {
            await recordFailure(line, 'not-applied', '');
        }
        await removeLine(line.id);
    }
}

let reconcileRegistered = false;

/**
 * 장부 확인을 **페이지 컨텍스트 한 곳에서만** 하도록 등록한다.
 *
 * 계기는 넷이다. 같은 컨텍스트 안의 겹친 호출은 reconcileLedger가 같은 Promise로 합친다.
 *   1) 앱 시작 — 지난 실행에 남은 줄
 *   2) 'online' — 연결 복귀
 *   3) 서비스워커의 FLUSH_SYNC_QUEUE 메시지 — 옛 버전이 등록한 Background Sync가 연결 복귀를 알려 올 때
 *   4) 화면 복귀 — 백그라운드에서 'online'을 놓친 경우
 */
export function registerLedgerReconcile() {
    if (reconcileRegistered) return;
    if (typeof window === 'undefined') return;
    reconcileRegistered = true;
    window.addEventListener('online', () => { void reconcileLedgerQuietly(); });
    navigator.serviceWorker?.addEventListener('message', (event: MessageEvent) => {
        if (event.data?.type === 'FLUSH_SYNC_QUEUE' && navigator.onLine) void reconcileLedgerQuietly();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && navigator.onLine) void reconcileLedgerQuietly();
    });
    if (navigator.onLine) void reconcileLedgerQuietly();
}
