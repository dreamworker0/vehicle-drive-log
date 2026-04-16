import { getOfflineActions, removeOfflineAction, incrementRetryCount } from './offlineSync';
import { createDriveLog, updateDriveLog } from './firestore/driveLogs';
import { isCreateDriveLogPayload, isUpdateDriveLogPayload } from '../types/driveLog';

export const processOfflineQueue = async () => {
    if (typeof window === 'undefined' || !navigator.onLine) return;

    try {
        const actions = await getOfflineActions();
        if (!actions.length) return;

        console.log(`[OfflineSync] 처리 대기 중인 액션: ${actions.length}건`);

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
                        // TODO: 예약 생성/수정/삭제 오프라인 지원 시 이곳에 구현
                        console.log(`[OfflineSync] 예약 관련 액션 대기 중 (미구현 상태): ${action.type}`);
                        break;
                    default:
                        console.warn(`[OfflineSync] 알 수 없는 액션 타입: ${action.type}`);
                        break;
                }

                // 성공 시 큐에서 제거
                await removeOfflineAction(action.id);
                console.log(`[OfflineSync] 액션 처리 완료: ${action.id} (${action.type})`);
            } catch (err: unknown) {
                console.error(`[OfflineSync] 액션 처리 실패: ${action.id}`, err);
                
                // 일시적인 네트워크 문제거나 서버 응답 없음인 경우 재시도 카운트 증가
                // 클라이언트 데이터 오류라 실패했다면(예: 문서 없음) 제거 처리할 수도 있음
                await incrementRetryCount(action.id);
            }
        }
    } catch (e) {
        console.error('[OfflineSyncProcessor] 큐 처리 중 오류:', e);
    }
};

/**
 * 전역 네트워크 상태 리스너를 등록하고 즉시 한 번 큐를 비우기 시도
 */
export const mountOfflineQueueProcessor = () => {
    if (typeof window === 'undefined') return () => {};

    // 온라인 전환 시 큐 비우기 실행
    const handleOnline = () => {
        console.log('[OfflineSync] 네트워크 온라인 감지, 큐 처리 시작...');
        processOfflineQueue();
    };

    window.addEventListener('online', handleOnline);

    // 서비스 워커(백그라운드 싱크)로부터 오는 동기화 요청 메시지 처리
    const handleServiceWorkerMessage = (event: MessageEvent) => {
        if (event.data && event.data.type === 'FLUSH_OFFLINE_QUEUE') {
            console.log('[OfflineSync] Service Worker의 Background Sync 요청 수신');
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
