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

export async function flushQueue() {
    const database = await getSyncDB();
    if (!database) return;

    const tx = database.transaction('sync-store', 'readwrite');
    const store = tx.objectStore('sync-store');
    const allRecords = await store.getAll();

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
            // 성공 시 큐에서 제거
            await store.delete(record.id as number);
        } catch (error) {
            console.error(`[SyncQueue] flush Error for ${record.docId}`, error);
            // 실패한 건은 그대로 두어 다음에 다시 시도할 수 있게 함
        }
    }
}
