/**
 * IndexedDB & Service Worker 기반 오프라인-퍼스트 싱크 제어 모듈
 * 
 * Firebase Native SDK의 오프라인 큐가 커버하지 못하는 브라우저 강제종료/성급한 탭 닫기 등에 대비하여
 * 쓰기 액션을 IndexedDB에 명시적으로 백업합니다.
 */

const DB_NAME = 'veh-log-offline-sync';
const STORE_NAME = 'action-queue';
const DB_VERSION = 1;

interface OfflineAction {
    id: string; // 고유 ID (timestamp + random)
    type: 'CREATE_DRIVELOG' | 'UPDATE_DRIVELOG' | 'CREATE_RESERVATION' | 'UPDATE_RESERVATION' | 'DELETE_DRIVELOG';
    payload: unknown;
    timestamp: number;
    retryCount: number;
}

// IndexedDB 초기화
const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        if (typeof window === 'undefined' || !window.indexedDB) {
            return reject(new Error('IndexedDB not supported'));
        }
        const request = window.indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e: IDBVersionChangeEvent) => {
            const db = (e.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

/** 새로운 액션을 큐에 추가 */
export const queueOfflineAction = async (type: OfflineAction['type'], payload: unknown) => {
    if (typeof window === 'undefined') return;
    try {
        const db = await openDB();
        const action: OfflineAction = {
            id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type,
            payload,
            timestamp: Date.now(),
            retryCount: 0,
        };
        
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.add(action);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
        
        // Background Sync 등록 (SW가 지원하는 경우)
        if ('serviceWorker' in navigator && 'SyncManager' in window) {
            try {
                const reg = await navigator.serviceWorker.ready;
                // @ts-expect-error sync object is not fully typed
                if (reg.sync) await reg.sync.register('sync-offline-actions');
            } catch (e) {
                console.warn('[OfflineSync] SW Background Sync 등록 실패:', e);
            }
        }
    } catch (e) {
        console.error('[OfflineSync] 오프라인 액션 큐 저장 실패:', e);
    }
};

/** 큐에 쌓인 모든 액션을 가져오기 */
export const getOfflineActions = async (): Promise<OfflineAction[]> => {
    if (typeof window === 'undefined') return [];
    try {
        const db = await openDB();
        return await new Promise<OfflineAction[]>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    } catch {
        return [];
    }
};

/** 특정 액션을 큐에서 제거 */
export const removeOfflineAction = async (id: string) => {
    if (typeof window === 'undefined') return;
    try {
        const db = await openDB();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.delete(id);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    } catch {
        // ignore removal errors
    }
};

/** 액션 실패 시 카운트 증가 */
export const incrementRetryCount = async (id: string) => {
    if (typeof window === 'undefined') return;
    try {
        const db = await openDB();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(id);
            req.onsuccess = () => {
                const action = req.result as OfflineAction;
                if (action) {
                    action.retryCount += 1;
                    const updateReq = store.put(action);
                    updateReq.onsuccess = () => resolve();
                    updateReq.onerror = () => reject();
                } else {
                    resolve();
                }
            };
            req.onerror = () => reject();
        });
    } catch {
        // ignore retry increment errors
    }
};
