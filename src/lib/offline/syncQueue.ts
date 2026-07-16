import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
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
        value: SyncData & { id?: number; timestamp: number };
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

export async function enqueue(type: SyncData['type'], collectionName: string, docId: string, data: Record<string, unknown> | null) {
    const database = await getSyncDB();
    if (!database) return;
    await database.add('sync-store', {
        type,
        collection: collectionName,
        docId,
        data,
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

export async function flushQueue() {
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
            if (record.type === 'CREATE') {
                if (record.data) await setDoc(docRef, record.data);
            } else if (record.type === 'UPDATE') {
                if (record.data) await updateDoc(docRef, record.data);
            } else if (record.type === 'DELETE') {
                await deleteDoc(docRef);
            }
            // 성공 시 큐에서 제거 — 자체 트랜잭션을 여는 database.delete를 사용해
            // Firestore await 뒤에도 유효한 트랜잭션에서 실행되도록 한다.
            await database.delete('sync-store', record.id as number);
        } catch (error) {
            console.error(`[SyncQueue] flush Error for ${record.docId}`, error);
            // 실패한 건은 그대로 두어 다음에 다시 시도할 수 있게 함
        }
    }
}
