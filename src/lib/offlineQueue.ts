/**
 * offlineQueue — 오프라인 상태에서 운행일지를 IndexedDB에 큐잉하고
 * 온라인 복귀 시 자동으로 Firestore에 동기화하는 유틸리티
 *
 * 지원 작업:
 * - create: 새 운행일지 생성
 * - update: 기존 운행일지 수정
 */

const DB_NAME = 'driveLogOfflineQueue';
const STORE_NAME = 'pendingLogs';
const DB_VERSION = 2; // 스키마 변경: action 필드 추가

/** IndexedDB 열기 */
function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

type QueueAction = 'create' | 'update';

interface QueuedLog {
    id?: number;
    action: QueueAction;
    /** update 시 대상 문서 ID */
    docId?: string;
    data: Record<string, unknown>;
    queuedAt: string; // ISO string
}

/** 오프라인 큐에 운행일지 저장 */
export async function enqueueLog(
    data: Record<string, unknown>,
    action: QueueAction = 'create',
    docId?: string,
): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add({
        action,
        docId,
        data,
        queuedAt: new Date().toISOString(),
    } satisfies Omit<QueuedLog, 'id'>);
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
}

/** 큐에 대기 중인 항목 수 조회 */
export async function getPendingCount(): Promise<number> {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).count();
        return new Promise((resolve) => {
            req.onsuccess = () => { db.close(); resolve(req.result); };
            req.onerror = () => { db.close(); resolve(0); };
        });
    } catch {
        return 0;
    }
}

/** 큐의 모든 항목 조회 */
async function getAllPending(): Promise<QueuedLog[]> {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    return new Promise((resolve) => {
        req.onsuccess = () => { db.close(); resolve(req.result); };
        req.onerror = () => { db.close(); resolve([]); };
    });
}

/** 특정 항목 삭제 */
async function removeLog(id: number): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    return new Promise((resolve) => {
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); resolve(); };
    });
}

/** 온라인 복귀 시 큐의 항목을 Firestore에 순서대로 저장 */
export async function processQueue(): Promise<number> {
    if (!navigator.onLine) return 0;
    const pending = await getAllPending();
    if (pending.length === 0) return 0;

    // 동적 import로 Firestore 함수 로드 (번들 최적화)
    const { createDriveLog, updateDriveLog } = await import('./firestore');
    let processed = 0;

    for (const item of pending) {
        try {
            if (item.action === 'update' && item.docId) {
                await updateDriveLog(item.docId, item.data as Parameters<typeof updateDriveLog>[1]);
            } else {
                await createDriveLog(item.data as Parameters<typeof createDriveLog>[0]);
            }
            if (item.id != null) await removeLog(item.id);
            processed++;
        } catch (err) {
            console.error('[OfflineQueue] 동기화 실패:', err);
            // 실패한 항목은 큐에 남겨두고 다음 온라인 시 재시도
            break;
        }
    }

    if (processed > 0) {
        console.info(`[OfflineQueue] ${processed}건 동기화 완료`);
    }
    return processed;
}

/** 온라인 복귀 이벤트에 자동 동기화 등록 */
let _registered = false;
function registerAutoSync() {
    if (_registered || typeof window === 'undefined') return;
    _registered = true;
    window.addEventListener('online', () => {
        // 약간의 딜레이 후 동기화 (네트워크 안정화 대기)
        setTimeout(() => { processQueue(); }, 1500);
    });
}

// 모듈 로드 시 자동 등록
registerAutoSync();
