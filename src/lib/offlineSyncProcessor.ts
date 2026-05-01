import { getOfflineActions, removeOfflineAction, incrementRetryCount, purgeStaleActions } from './offlineSync';
import { createDriveLog, updateDriveLog } from './firestore/driveLogs';
import { isCreateDriveLogPayload, isUpdateDriveLogPayload } from '../types/driveLog';

// 동시 실행 방지 lock
let _processing = false;

/**
 * 오프라인 큐의 모든 액션을 순서대로 처리한 뒤 처리 건수를 반환합니다.
 * 동시 호출 시 lock으로 중복 실행을 방지합니다.
 */
export const processOfflineQueue = async (): Promise<number> => {
    if (typeof window === 'undefined' || !navigator.onLine) return 0;
    if (_processing) {
        console.debug('[OfflineSync] 이미 큐 처리 중 — 중복 실행 방지');
        return 0;
    }

    _processing = true;
    let processed = 0;

    try {
        // 만료된 액션 먼저 정리
        await purgeStaleActions();

        const actions = await getOfflineActions();
        if (!actions.length) return 0;

        console.debug(`[OfflineSync] 처리 대기 중인 액션: ${actions.length}건`);

        for (const action of actions) {
            try {
                if (action.retryCount >= 10) {
                    console.error(`[OfflineSync] 재시도 횟수 초과로 액션 포기: ${action.id}`);
                    await removeOfflineAction(action.id);
                    continue;
                }

                switch (action.type) {
                    case 'CREATE_DRIVELOG':
                        if (isCreateDriveLogPayload(action.payload)) {
                            await createDriveLog(action.payload);
                        } else {
                            console.warn('[OfflineSync] Invalid CREATE payload:', action.payload);
                        }
                        break;
                    case 'UPDATE_DRIVELOG':
                        if (isUpdateDriveLogPayload(action.payload)) {
                            await updateDriveLog(action.payload.id, action.payload);
                        } else {
                            console.warn('[OfflineSync] Invalid UPDATE payload:', action.payload);
                        }
                        break;
                    case 'CREATE_RESERVATION':
                    case 'UPDATE_RESERVATION':
                    case 'DELETE_RESERVATION':
                        // 예약은 서버 트랜잭션(createReservationSafe)으로만 처리 가능하므로
                        // 오프라인 지원은 구조적으로 불가 — 온라인 복귀 시 사용자에게 재시도 안내
                        console.debug(`[OfflineSync] 예약 관련 액션은 오프라인 미지원: ${action.type}`);
                        break;
                    default:
                        console.warn(`[OfflineSync] 알 수 없는 액션 타입: ${action.type}`);
                        break;
                }

                // 성공 시 큐에서 제거
                await removeOfflineAction(action.id);
                processed++;
                console.debug(`[OfflineSync] 액션 처리 완료: ${action.id} (${action.type})`);
            } catch (err: unknown) {
                console.error(`[OfflineSync] 액션 처리 실패: ${action.id}`, err);
                
                // 일시적인 네트워크 문제거나 서버 응답 없음인 경우 재시도 카운트 증가
                // 클라이언트 데이터 오류라 실패했다면(예: 문서 없음) 제거 처리할 수도 있음
                await incrementRetryCount(action.id);
            }
        }
    } catch (e) {
        console.error('[OfflineSyncProcessor] 큐 처리 중 오류:', e);
    } finally {
        _processing = false;
    }

    if (processed > 0) {
        console.info(`[OfflineSync] ${processed}건 동기화 완료`);
    }

    return processed;
};

/**
 * 전역 네트워크 상태 리스너를 등록하고 즉시 한 번 큐를 비우기 시도
 */
export const mountOfflineQueueProcessor = () => {
    if (typeof window === 'undefined') return () => {};

    // 온라인 전환 시 큐 비우기 실행 (안정화 딜레이 포함)
    const handleOnline = () => {
        console.debug('[OfflineSync] 네트워크 온라인 감지, 큐 처리 시작...');
        setTimeout(() => { processOfflineQueue(); }, 1500);
    };

    window.addEventListener('online', handleOnline);

    // 서비스 워커(백그라운드 싱크)로부터 오는 동기화 요청 메시지 처리
    const handleServiceWorkerMessage = (event: MessageEvent) => {
        if (event.data && event.data.type === 'FLUSH_OFFLINE_QUEUE') {
            console.debug('[OfflineSync] Service Worker의 Background Sync 요청 수신');
            processOfflineQueue();
        }
    };
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
    }

    // 마운트 시점에 한 번 체크
    if (navigator.onLine) {
        processOfflineQueue();
    }

    return () => {
        window.removeEventListener('online', handleOnline);
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
        }
    };
};
