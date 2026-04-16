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
    type: 'CREATE_DRIVELOG' | 'UPDATE_DRIVELOG' | 'CREATE_RESERVATION' | 'UPDATE_RESERVATION' | 'DELETE_RESERVATION' | 'DELETE_DRIVELOG';
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
            req.onsuccess = () => { db.close(); resolve(); };
            req.onerror = () => { db.close(); reject(req.error); };
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
            req.onsuccess = () => { db.close(); resolve(req.result); };
            req.onerror = () => { db.close(); reject(req.error); };
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
            req.onsuccess = () => { db.close(); resolve(); };
            req.onerror = () => { db.close(); reject(req.error); };
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
                    updateReq.onsuccess = () => { db.close(); resolve(); };
                    updateReq.onerror = () => { db.close(); reject(); };
                } else {
                    db.close();
                    resolve();
                }
            };
            req.onerror = () => { db.close(); reject(); };
        });
    } catch {
        // ignore retry increment errors
    }
};

/** 큐에 대기 중인 항목 수 조회 (OfflineBanner 등에서 사용) */
export const getPendingCount = async (): Promise<number> => {
    if (typeof window === 'undefined') return 0;
    try {
        const db = await openDB();
        return await new Promise<number>((resolve) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.count();
            req.onsuccess = () => { db.close(); resolve(req.result); };
            req.onerror = () => { db.close(); resolve(0); };
        });
    } catch {
        return 0;
    }
};

/**
 * 만료된 오프라인 액션 정리 (기본 7일 초과)
 * @returns 삭제된 항목 수
 */
const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7일
export const purgeStaleActions = async (): Promise<number> => {
    if (typeof window === 'undefined') return 0;
    try {
        const actions = await getOfflineActions();
        const cutoff = Date.now() - STALE_THRESHOLD_MS;
        let purged = 0;
        for (const action of actions) {
            if (action.timestamp < cutoff) {
                console.warn(`[OfflineSync] 만료 액션 제거 (${Math.round((Date.now() - action.timestamp) / 86400000)}일 경과): ${action.id}`);
                await removeOfflineAction(action.id);
                purged++;
            }
        }
        if (purged > 0) {
            console.info(`[OfflineSync] ${purged}건의 만료 액션 정리 완료`);
        }
        return purged;
    } catch {
        return 0;
    }
};

/**
 * 호환용 래퍼: offlineQueue.ts의 enqueueLog를 대체
 * submitDriveLog 등에서 사용
 */
export const enqueueLog = async (
    data: Record<string, unknown>,
    action: 'create' | 'update' = 'create',
    docId?: string,
): Promise<void> => {
    const type: OfflineAction['type'] = action === 'update' ? 'UPDATE_DRIVELOG' : 'CREATE_DRIVELOG';
    const payload = docId ? { ...data, id: docId } : data;
    await queueOfflineAction(type, payload);
};
