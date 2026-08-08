import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { doc, setDoc, updateDoc, deleteDoc, serverTimestamp, FieldValue, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';

export interface SyncData {
    type: 'CREATE' | 'UPDATE' | 'DELETE';
    collection: string;
    docId: string;
    data: Record<string, unknown> | null;
}

interface SyncDB extends DBSchema {
    'sync-store': {
        key: number;
        value: SyncData & { id?: number; timestamp: number; retryCount?: number };
        indexes: { 'by-timestamp': number };
    };
}

let dbPromise: Promise<IDBPDatabase<SyncDB>> | null = null;

export function getSyncDB() {
    if (!dbPromise) {
        dbPromise = openDB<SyncDB>('sync-db', 1, {
            upgrade(database) {
                if (!database.objectStoreNames.contains('sync-store')) {
                    const store = database.createObjectStore('sync-store', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('by-timestamp', 'timestamp');
                }
            },
        });
    }
    return dbPromise;
}

/**
 * serverTimestamp() 센티널의 IndexedDB 저장용 마커.
 *
 * FieldValue 센티널은 클래스 인스턴스라 structuredClone(IndexedDB 저장)을 거치면
 * 프로토타입이 소실되어, flush 재생 시 유효한 센티널이 아닌 빈 맵 필드로 기록된다.
 * 저장 시 이 문자열로 치환하고 flush 시 serverTimestamp()로 복원한다.
 */
export const SERVER_TIMESTAMP_MARKER = '__syncQueue.serverTimestamp__';

// 영구 실패로 판정해 재시도 없이 폐기하는 Firestore 오류 코드.
// (unavailable·deadline-exceeded 같은 네트워크성 오류는 재시도 대상)
const PERMANENT_ERROR_CODES = new Set(['permission-denied', 'invalid-argument', 'not-found', 'already-exists']);

// 일시 오류 재시도 상한 — 초과 시 폐기해 poison message가 큐를 영원히 점유하지 않게 한다.
const MAX_RETRIES = 5;

/**
 * IndexedDB에 안전하게 저장 가능한 형태로 변환한다.
 * - FieldValue 센티널 → 마커 문자열 (오프라인 쓰기 경로의 FieldValue는 serverTimestamp뿐)
 * - Firestore Timestamp → Date (Timestamp도 클래스라 clone 시 프로토타입이 소실되지만,
 *   Date는 structuredClone을 그대로 통과하고 Firestore가 timestamp로 기록한다)
 */
function toStorable(value: unknown): unknown {
    if (value instanceof FieldValue) return SERVER_TIMESTAMP_MARKER;
    if (value instanceof Timestamp) return value.toDate();
    if (Array.isArray(value)) return value.map(toStorable);
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toStorable(v)]));
    }
    return value;
}

// 저장 시 치환한 마커를 flush 직전에 실제 센티널로 복원한다.
function fromStorable(value: unknown): unknown {
    if (value === SERVER_TIMESTAMP_MARKER) return serverTimestamp();
    if (Array.isArray(value)) return value.map(fromStorable);
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fromStorable(v)]));
    }
    return value;
}

export async function enqueue(type: SyncData['type'], collectionName: string, docId: string, data: Record<string, unknown> | null) {
    const database = await getSyncDB();
    if (!database) return;
    await database.add('sync-store', {
        type,
        collection: collectionName,
        docId,
        data: data ? (toStorable(data) as Record<string, unknown>) : null,
        timestamp: Date.now(),
    });
}

/**
 * 오프라인 동기화 큐를 전부 비운다.
 * 큐 항목은 사용자·기관 식별자 없이 저장되므로, 로그아웃 시 폐기하지 않으면
 * 공용 기기에서 다음 세션에 미동기 쓰기가 재생될 수 있다 (2026-07-10 감사 #8).
 */
export async function clearQueue() {
    const database = await getSyncDB();
    if (!database) return;
    await database.clear('sync-store');
}

// 동시 flush 방지 — SW sync 이벤트와 window 'online' 폴백이 겹칠 수 있다.
// (SW와 페이지는 모듈 인스턴스가 분리되므로 이 플래그는 각 컨텍스트 내부만 보호한다)
let flushing = false;

export async function flushQueue() {
    if (flushing) return;
    flushing = true;
    try {
        const database = await getSyncDB();
        if (!database) return;

        // 단일 트랜잭션을 열어두고 그 안에서 Firestore 네트워크 쓰기를 await하면 안 된다.
        // IndexedDB 트랜잭션은 비-IDB Promise를 await하는 순간 auto-commit되어 비활성화되고,
        // 그 뒤의 store.delete는 "Attempt to delete range from database without an in-progress
        // transaction"(WebKit) 등으로 실패한다. 따라서 읽기·삭제를 각각 독립된 짧은 트랜잭션으로 분리한다.
        const allRecords = await database.getAll('sync-store');

        if (allRecords.length === 0) return;

        for (const record of allRecords) {
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
                    await database.delete('sync-store', record.id as number);
                } else {
                    console.error(`[SyncQueue] flush 실패, 재시도 예정 (${retryCount}/${MAX_RETRIES}) — ${record.docId}`, error);
                    await database.put('sync-store', { ...record, retryCount });
                }
            }
        }
    } finally {
        flushing = false;
    }
}

let reconnectFlushRegistered = false;

/**
 * Background Sync('SyncManager') 미지원 브라우저용 flush 폴백.
 *
 * iOS Safari는 SyncManager가 없어 SW 'sync' 이벤트 경로가 영원히 실행되지 않는다
 * (sentry.ts의 iOS 필터 주석 참고). 그런 환경에서는 페이지 컨텍스트의 'online'
 * 이벤트와 앱 시작 시점에 직접 flush한다. SyncManager 지원 브라우저는 SW 경로가
 * 처리하므로 등록하지 않는다 — 두 컨텍스트의 동시 flush 경합을 피한다.
 */
export function registerReconnectFlush() {
    if (reconnectFlushRegistered) return;
    if (typeof window === 'undefined' || 'SyncManager' in window) return;
    reconnectFlushRegistered = true;
    window.addEventListener('online', () => { void flushQueue(); });
    // 이전 세션에서 flush되지 못하고 남은 항목 처리
    if (navigator.onLine) void flushQueue();
}
