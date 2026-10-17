import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { doc, setDoc, updateDoc, deleteDoc, serverTimestamp, deleteField, FieldValue, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';

export interface SyncData {
    type: 'CREATE' | 'UPDATE' | 'DELETE';
    collection: string;
    docId: string;
    data: Record<string, unknown> | null;
}

/** 폐기 사유 — 사용자 안내 문구를 가르는 유일한 기준 */
export type FailedReason = 'permanent' | 'retry-exhausted';

/** 큐에서 폐기된(= 서버에 반영되지 못한) 항목의 보관 형태 */
export interface FailedRecord extends SyncData {
    id?: number;
    /** 원래 큐에 적재된 시각 */
    timestamp: number;
    /** 폐기된 시각 */
    failedAt: number;
    reason: FailedReason;
    /** Firestore 오류 코드 (재시도 소진이면 마지막 오류 코드, 없으면 '') */
    code: string;
}

interface SyncDB extends DBSchema {
    'sync-store': {
        key: number;
        // lastAttemptAt은 **적재 시각(timestamp)과 다르다** — 마지막으로 전송을 시도한 시각이며
        // 재시도 냉각(retryCooldownMs) 판정에만 쓴다.
        value: SyncData & { id?: number; timestamp: number; retryCount?: number; lastAttemptAt?: number };
        indexes: { 'by-timestamp': number };
    };
    // 폐기된 항목의 무덤. 큐 모듈은 화면(토스트)에 의존하지 않으므로 폐기 사실을 여기에
    // 남겨 두고, 페이지 컨텍스트(syncFailureNotice)가 flush 뒤·다음 기회에 읽어서 사용자에게 알린다.
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
            // 연결을 세션 내내 들고 있어 화면 복귀 flush가 바로 그 연결로 읽다 실패했다
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
 * 여전히 죽은 연결을 쓴다. 화면 복귀는 flush 계기(registerReconnectFlush ④)라 정확히 그
 * 순간에 읽기가 실패해 처리되지 않은 거부로 올라왔다(Sentry JAVASCRIPT-REACT-6N, iOS 18.7).
 * 같은 죽은 연결로 enqueue가 실패하면 **오프라인 쓰기를 큐에 담지 못한다** — 이쪽이 더 크다.
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
 * 프로토타입이 소실되어, flush 재생 시 유효한 센티널이 아닌 빈 맵 필드로 기록된다.
 * 저장 시 이 문자열로 치환하고 flush 시 serverTimestamp()로 복원한다.
 */
export const SERVER_TIMESTAMP_MARKER = '__syncQueue.serverTimestamp__';
/**
 * 필드 삭제 센티널 마커.
 *
 * 예전에는 FieldValue를 전부 serverTimestamp로 뭉뚱그렸다 — 오프라인 쓰기 경로에 그것뿐이라는
 * 전제였다. 운행일지 수정이 `deleteField()`로 출발일을 지우기 시작하면서 그 전제가 깨졌고,
 * 그대로 두면 오프라인 수정이 재생될 때 **날짜 문자열 자리에 타임스탬프가 박힌다.**
 */
export const DELETE_FIELD_MARKER = '__syncQueue.deleteField__';

// 영구 실패로 판정해 재시도 없이 폐기하는 Firestore 오류 코드.
// (unavailable·deadline-exceeded 같은 네트워크성 오류는 재시도 대상)
const PERMANENT_ERROR_CODES = new Set(['permission-denied', 'invalid-argument', 'not-found', 'already-exists']);

// 일시 오류 재시도 상한 — 초과 시 폐기해 poison message가 큐를 영원히 점유하지 않게 한다.
const MAX_RETRIES = 5;

/**
 * 재시도 냉각 시간 — **횟수만 세면 안 되는 이유가 있다.**
 *
 * flush는 `online` 이벤트마다 돈다. 지하철·엘리베이터처럼 연결이 몇 초 단위로 끊겼다 붙는
 * 환경에서는 1~2분 안에 5회가 소진되어, 조금 더 기다리면 올라갈 수 있었던 기록이 폐기된다.
 * "5번이나 시도했는데 안 되면 포기"라는 의도가 실제로는 "연결이 5번 깜빡이면 포기"로 동작했다.
 *
 * 그래서 실패한 항목은 다음 시도까지 **점점 길어지는 냉각 시간**을 둔다
 * (1·2·4·8·16분 → 폐기까지 총 약 31분). 출퇴근 이동 한 구간을 버티는 길이다.
 * 냉각 중에 건너뛴 것은 시도로 세지 않는다 — 그래야 대기가 횟수를 소모하지 않는다.
 */
const RETRY_BASE_COOLDOWN_MS = 60_000;
const RETRY_MAX_COOLDOWN_MS = 30 * 60_000;

export function retryCooldownMs(retryCount: number): number {
    if (retryCount <= 0) return 0;
    return Math.min(RETRY_BASE_COOLDOWN_MS * 2 ** (retryCount - 1), RETRY_MAX_COOLDOWN_MS);
}

/**
 * FieldValue 센티널을 종류별 마커로 가른다.
 *
 * 한동안 이 자리는 "오프라인 쓰기 경로의 FieldValue는 serverTimestamp뿐"이라는 전제 위에서
 * 전부 하나로 뭉뚱그렸다. 운행일지 수정이 `deleteField()`를 쓰기 시작하면서 그 전제가 깨졌고,
 * 재생될 때 **날짜 문자열 자리에 타임스탬프가 박혔다.** 그래서 아는 것만 통과시키는 화이트리스트로
 * 둔다 — `increment()`·`arrayUnion()`이 나중에 이 경로에 들어와도 같은 사고가 조용히 되풀이되지
 * 않고 여기서 걸린다.
 *
 * 판별은 Firestore가 공개하는 `_methodName`으로 한다(실물 번들에서 이름이 유지되는 것을 확인했다).
 */
function sentinelMarker(value: FieldValue): string {
    const method = (value as unknown as { _methodName?: string })._methodName;
    if (method === 'deleteField') return DELETE_FIELD_MARKER;
    if (method === 'serverTimestamp') return SERVER_TIMESTAMP_MARKER;
    // 모르는 센티널을 아무 쪽으로나 떨어뜨리면 그 필드에 엉뚱한 값이 **덮인다.**
    // 조용한 오염보다 시끄러운 실패가 낫다.
    throw new Error(`[syncQueue] 오프라인 큐가 다루지 못하는 FieldValue: ${method ?? 'unknown'}`);
}

/**
 * 평범한 객체(`{}` 리터럴·JSON 모양)인가 — 재귀해 들어갈 대상.
 *
 * `Object.getPrototypeOf(v) === Object.prototype`으로 비교하면 **다른 영역(realm)에서 만든 객체**를
 * 놓친다. IndexedDB가 structured clone으로 돌려준 값은 그 저장소 구현의 영역에 속할 수 있어서,
 * 그 경우 저장해 둔 마커를 복원하지 못한 채 재생된다(Vitest vmThreads + fake-indexeddb에서 실측,
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

// 저장 시 치환한 마커를 flush 직전에 실제 센티널로 복원한다.
function fromStorable(value: unknown): unknown {
    if (value === SERVER_TIMESTAMP_MARKER) return serverTimestamp();
    if (value === DELETE_FIELD_MARKER) return deleteField();
    if (Array.isArray(value)) return value.map(fromStorable);
    if (isPlainObject(value)) {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fromStorable(v)]));
    }
    return value;
}

export async function enqueue(type: SyncData['type'], collectionName: string, docId: string, data: Record<string, unknown> | null) {
    const record = {
        type,
        collection: collectionName,
        docId,
        data: data ? (toStorable(data) as Record<string, unknown>) : null,
        timestamp: Date.now(),
    };
    await withSyncDB(async (database) => { await database.add('sync-store', record); });
}

/**
 * 오프라인 동기화 큐를 전부 비운다.
 * 큐 항목은 사용자·기관 식별자 없이 저장되므로, 로그아웃 시 폐기하지 않으면
 * 공용 기기에서 다음 세션에 미동기 쓰기가 재생될 수 있다 (2026-07-10 감사 #8).
 *
 * 폐기 기록(failed-store)도 같이 비운다 — 같은 이유로, 다음 사용자에게 남의
 * 유실 안내가 뜨면 안 된다.
 */
export async function clearQueue() {
    await withSyncDB(async (database) => {
        await database.clear('sync-store');
        await database.clear('failed-store');
    });
}

/**
 * 아직 서버에 올라가지 못한 항목 수. 화면에 "미전송 N건"을 띄우는 데만 쓴다.
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
 * 폐기 기록을 **읽기만** 한다. 비우지 않는다.
 *
 * 읽기와 삭제를 갈라 둔 이유는 `clearFailedRecords`에 적어 두었다 — 알리기 전에 지우면
 * 유실을 알리는 장치가 유실되고, 통째로 비우면 사이에 들어온 폐기가 함께 사라진다.
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
 * 스토어를 통째로 비워서도 안 된다. 읽은 뒤 지우기까지 사이에 다른 탭의 flush가 새 폐기를
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

// 동시 flush 방지 — 'online'·앱 시작·SW 메시지·화면 복귀가 겹칠 수 있다.
// (이 값은 한 컨텍스트 안만 보호한다. 그래서 flush는 페이지에서만 한다 — registerReconnectFlush)
//
// 불리언이 아니라 진행 중인 Promise를 붙잡아 둔다. 겹친 호출이 즉시 반환해 버리면
// "flush가 끝난 뒤 폐기분을 안내"하려는 호출자(syncFailureNotice)가 아직 시작도 안 한
// 큐를 보고 '유실 없음'으로 판단한다. 같은 Promise를 돌려주면 누가 부르든 같은 완료 시점을 본다.
let flushing: Promise<void> | null = null;

export function flushQueue(): Promise<void> {
    if (flushing) return flushing;
    flushing = runFlush().finally(() => { flushing = null; });
    return flushing;
}

/**
 * 이 기기에서 **IndexedDB 자체를 쓸 수 없을 때** 나오는 문구들.
 *
 * WebKit은 IDB 백엔드를 잃으면 여는 것부터 이 문구로 거부한다(iOS Safari). 그런 기기에서
 * flush가 할 수 있는 일은 없다 — 다음 계기에 다시 시도하는 것 말고는.
 *
 * **여기 없는 실패는 삼키지 않는다.** 예컨대 Firestore 쓰기는 성공했는데 큐에서 지우기가
 * 실패하면 같은 문서가 매번 다시 전송되고 '미전송 N건'이 영영 남는다. 그건 환경이 아니라
 * 우리 문제이고, 보이지 않으면 고칠 수 없다 — 이 이슈도 처리되지 않은 거부로 드러나서 찾았다.
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
 * 페이지 컨텍스트에서 쓰는 flush — **IDB를 못 쓰는 기기에서만** 실패를 삼킨다.
 *
 * `online`·앱 시작 같은 계기에서 부르는 쪽은 결과를 기다리지 않는다(`void`). 그래서 IDB가
 * 통째로 실패하는 기기에서는 runFlush의 거부가 곧 **처리되지 않은 프라미스 거부**가 되어
 * 스택 없는 오류로 Sentry에 올라왔다(JAVASCRIPT-REACT-6H, iOS Safari). 그 자리에서 사용자에게
 * 할 말도, 할 수 있는 일도 없으므로 경고만 남기고 넘어간다.
 *
 * 그 밖의 실패는 **그대로 드러낸다**(isIdbUnusable 주석 참고). 전부 삼키면 큐가 영영 비지
 * 않는 종류의 결함이 조용해진다.
 *
 * 서비스워커는 더 이상 flush하지 않는다(sw.ts 'sync' 주석) — flush 계기는 모두 페이지에 있다.
 */
export function flushQueueQuietly(): Promise<void> {
    return flushQueue().catch((error) => {
        if (!isIdbUnusable(error)) throw error;
        console.warn('[SyncQueue] IDB를 쓸 수 없어 flush를 건너뛴다 — 다음 계기에 다시 시도한다', error);
    });
}

async function runFlush(): Promise<void> {
    // 단일 트랜잭션을 열어두고 그 안에서 Firestore 네트워크 쓰기를 await하면 안 된다.
    // IndexedDB 트랜잭션은 비-IDB Promise를 await하는 순간 auto-commit되어 비활성화되고,
    // 그 뒤의 store.delete는 "Attempt to delete range from database without an in-progress
    // transaction"(WebKit) 등으로 실패한다. 따라서 읽기·삭제를 각각 독립된 짧은 트랜잭션으로 분리한다.
    //
    // 첫 읽기만 withSyncDB로 감싼다 — 화면 복귀 직후 죽은 연결을 만나는 곳이 여기다. 아래 루프는
    // Firestore 쓰기를 끼고 있어 통째로 다시 할 수 없다. 루프 중간에 연결이 끊기면 지금처럼
    // 실패로 끝나고, 남은 항목은 다음 계기에 새 연결로 이어 보낸다.
    const allRecords = await withSyncDB((database) => database.getAll('sync-store'));
    const database = await getSyncDB();

    if (allRecords.length === 0) return;

    // 이번 flush에서 **뒤 항목까지 붙잡아 둘** 문서들. autoIncrement 키 순서 = 적재 순서이므로
    // getAll은 사용자가 쓴 순서를 그대로 돌려주는데, 선행 항목을 건너뛰고 후속만 보내면
    // 그 순서가 깨진다 (아래 blockKey 주석 참고).
    const blocked = new Set<string>();
    const docKey = (r: { collection: string; docId: string }) => `${r.collection}/${r.docId}`;

    for (const record of allRecords) {
        // 같은 문서의 선행 항목이 아직 큐에 남아 있으면 이 항목도 보내지 않는다.
        //
        // **왜 필요한가.** 오프라인에서 운행일지를 만들고(CREATE) 도착 km를 채우면(UPDATE)
        // 두 항목이 순서대로 쌓인다. CREATE가 일시 오류로 냉각에 들어간 채 UPDATE만 전송되면
        // 아직 없는 문서를 고치려는 셈이라 not-found가 나고, not-found는 PERMANENT_ERROR_CODES에
        // 있어 **재시도 없이 폐기**된다. 잠시 뒤 CREATE는 성공한다 — 결과는 '도착 km가 비어 있는
        // 운행일지'다. Rules(kmOrderValid)까지 만들어 지키려던 정합성이 여기서 깨진다.
        // DELETE도 같다: 냉각 중인 CREATE를 앞질러 DELETE가 성공하면, 뒤늦게 올라간 CREATE가
        // 지운 문서를 되살린다.
        //
        // 이 continue도 냉각 건너뛰기와 마찬가지로 **시도로 세지 않는다** — 남을 기다린 것이
        // 자기 재시도 횟수를 깎으면 안 된다.
        if (blocked.has(docKey(record))) {
            continue;
        }

        // 냉각 중인 항목은 건너뛴다. 이 continue는 시도로 세지 않으므로 retryCount가 줄지 않고,
        // 연결이 깜빡이는 동안 재시도 횟수가 헛되게 소모되지 않는다.
        const cooldown = retryCooldownMs(record.retryCount ?? 0);
        if (cooldown > 0 && record.lastAttemptAt !== undefined && Date.now() - record.lastAttemptAt < cooldown) {
            blocked.add(docKey(record));
            continue;
        }

        try {
            const docRef = doc(db, record.collection, record.docId);
            const payload = record.data ? (fromStorable(record.data) as Record<string, unknown>) : null;
            if (record.type === 'CREATE') {
                if (payload) await setDoc(docRef, payload);
            } else if (record.type === 'UPDATE') {
                if (payload) await updateDoc(docRef, payload);
            } else if (record.type === 'DELETE') {
                await deleteDoc(docRef);
            }
            // 성공 시 큐에서 제거 — 자체 트랜잭션을 여는 database.delete를 사용해
            // Firestore await 뒤에도 유효한 트랜잭션에서 실행되도록 한다.
            await database.delete('sync-store', record.id as number);
        } catch (error) {
            const code = (error as { code?: string })?.code ?? '';
            const isPermanent = PERMANENT_ERROR_CODES.has(code.replace(/^firestore\//, ''));
            const retryCount = (record.retryCount ?? 0) + 1;
            if (isPermanent || retryCount >= MAX_RETRIES) {
                // 영구 오류(권한 거부 등)나 재시도 소진 항목은 폐기한다 — 그대로 두면
                // 매 flush마다 영원히 재시도되며 큐 전체를 오염시킨다(poison message).
                console.error(
                    `[SyncQueue] ${record.docId} 폐기 — ${isPermanent ? `영구 오류(${code})` : `재시도 ${MAX_RETRIES}회 초과`}`,
                    error,
                );
                // 폐기 = 사용자가 오프라인에서 쓴 기록이 서버에 영영 반영되지 않는다는 뜻이다.
                // 콘솔에만 남기면 운전자는 유실을 모른 채 지나가므로, 무덤에 옮겨 두고
                // 페이지가 안내하게 한다. 여기서 실패하더라도 폐기 자체는 진행한다
                // (무덤 쓰기 실패로 poison message가 큐에 남는 쪽이 더 나쁘다).
                try {
                    await database.add('failed-store', {
                        type: record.type,
                        collection: record.collection,
                        docId: record.docId,
                        data: record.data,
                        timestamp: record.timestamp,
                        failedAt: Date.now(),
                        reason: isPermanent ? 'permanent' : 'retry-exhausted',
                        code,
                    });
                } catch (writeError) {
                    console.error('[SyncQueue] 폐기 기록 저장 실패', writeError);
                }
                await database.delete('sync-store', record.id as number);
                // 폐기한 문서는 blocked에 넣지 않는다 — 선행 항목이 영영 반영되지 않으면
                // 후속 항목도 닿을 곳이 없다. 그때는 붙잡아 두고 재시도 상한(약 31분)을
                // 태우기보다 지금 같이 폐기해, 사용자에게 '유실'을 정확한 사유로 즉시 알린다.
            } else {
                const waitMin = Math.round(retryCooldownMs(retryCount) / 60_000);
                console.error(
                    `[SyncQueue] flush 실패, ${waitMin}분 후 재시도 (${retryCount}/${MAX_RETRIES}) — ${record.docId}`,
                    error,
                );
                await database.put('sync-store', { ...record, retryCount, lastAttemptAt: Date.now() });
                // 큐에 남겨 재시도할 항목이므로 같은 문서의 후속은 이번 회차에 보내지 않는다.
                blocked.add(docKey(record));
            }
        }
    }
}

let reconnectFlushRegistered = false;

/**
 * 큐 flush를 **페이지 컨텍스트 한 곳에서만** 하도록 등록한다 (모든 브라우저).
 *
 * 예전에는 SyncManager 지원 브라우저(Android Chrome 등)는 서비스워커가 비우게 두고 여기서는
 * 등록하지 않았다. 그런데 서비스워커에는 App Check가 없어 Firestore(App Check ENFORCED)
 * 쓰기가 거부될 수 있고, syncFailureNotice의 online flush는 브라우저를 가리지 않아 두
 * 컨텍스트가 같은 큐를 동시에 비우고 있었다(sw.ts 'sync' 주석 참고). 이제 쓰기는 여기서만 한다.
 *
 * 계기는 넷이다. 같은 컨텍스트 안의 겹친 호출은 flushQueue가 같은 Promise로 합친다.
 *   1) 앱 시작 — 이전 세션에 남은 항목
 *   2) 'online' — 연결 복귀
 *   3) 서비스워커의 FLUSH_SYNC_QUEUE 메시지 — Background Sync가 연결 복귀를 알려 올 때
 *   4) 화면 복귀 — 백그라운드에서 'online'을 놓쳤거나 재시도 냉각이 끝난 항목
 */
export function registerReconnectFlush() {
    if (reconnectFlushRegistered) return;
    if (typeof window === 'undefined') return;
    reconnectFlushRegistered = true;
    window.addEventListener('online', () => { void flushQueueQuietly(); });
    navigator.serviceWorker?.addEventListener('message', (event: MessageEvent) => {
        if (event.data?.type === 'FLUSH_SYNC_QUEUE' && navigator.onLine) void flushQueueQuietly();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && navigator.onLine) void flushQueueQuietly();
    });
    // 이전 세션에서 flush되지 못하고 남은 항목 처리
    if (navigator.onLine) void flushQueueQuietly();
}
