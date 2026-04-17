/**
 * driveLogs/mutations.ts
 * 운행일지 쓰기(Create/Update/Delete) 작업 — CQRS 쓰기 측
 */
import {
    doc, updateDoc, deleteDoc, setDoc,
    collection, query, where, getDocs,
    serverTimestamp, increment,
} from 'firebase/firestore';
import { db } from '../../firebase';
import type { DriveLog } from '../../../types/driveLog';
import { captureError } from '../../sentry';
import {
    sanitizeUndefined,
    getVehicleEndKmBefore,
    syncNextLogStartKm,
    hasLaterDriveLog,
} from './utils';

// 운행일지 생성 (중복 방지 체크 포함)
export const createDriveLog = async (data: Partial<DriveLog>) => {
    try {
        const logDate = data.timestamp instanceof Date ? data.timestamp : new Date();

        // 중복 체크: 같은 기관+차량+운전자+startKm+endKm 이 같은 날짜에 이미 존재하면 거부
        if (data.organizationId && data.vehicleId && data.driverUid && data.startKm != null && data.endKm != null) {
            const dayStart = new Date(logDate.getFullYear(), logDate.getMonth(), logDate.getDate());
            const dayEnd = new Date(logDate.getFullYear(), logDate.getMonth(), logDate.getDate() + 1);

            const dupQuery = query(
                collection(db, 'driveLogs'),
                where('organizationId', '==', data.organizationId),
                where('vehicleId', '==', data.vehicleId),
                where('driverUid', '==', data.driverUid),
                where('timestamp', '>=', dayStart),
                where('timestamp', '<', dayEnd),
            );
            const dupSnap = await getDocs(dupQuery);
            const duplicate = dupSnap.docs.some(d => {
                const existing = d.data();
                return existing.startKm === data.startKm && existing.endKm === data.endKm;
            });
            if (duplicate) {
                throw new Error('동일한 운행 기록이 이미 존재합니다. 중복 저장을 방지했습니다.');
            }
        }

        const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

        // === [추가된 방어 로직] 출발 Km 자동 보정 ===
        const originalStartKm = data.startKm;
        let correctedStartKm = originalStartKm || 0;
        let autocorrectedDistance = false;

        if (data.organizationId && data.vehicleId && data.endKm != null && data.startKm != null && data.timestamp && !isOffline) {
            const logDate = data.timestamp instanceof Date ? data.timestamp : (data.timestamp as import("firebase/firestore").Timestamp).toDate ? (data.timestamp as import("firebase/firestore").Timestamp).toDate() : new Date();
            // 방금 입력하려는 시간 기준 "직전" 기록의 endKm을 조회
            const beforeEndKm = await getVehicleEndKmBefore(data.organizationId as string, data.vehicleId as string, logDate);

            // 직전 기록이 존재하고, 직전 마지막 도착 km가 현재 폼의 출발 km와 다르다면
            if (beforeEndKm !== null && beforeEndKm !== correctedStartKm) {
                correctedStartKm = beforeEndKm;
                const newDistance = data.endKm - correctedStartKm;

                if (newDistance < 0) {
                    // 음수가 된다면 운행 거리가 꼬이는 치명적 상태이므로 저장을 막음
                    throw new Error(`동기화 오류: 다른 사용자가 더 높은 누적 km(${beforeEndKm}km)를 이미 등록했습니다. 내역을 갱신해주세요.`);
                }

                data.startKm = correctedStartKm;
                data.distance = newDistance;
                autocorrectedDistance = true;
            }
        }
        // === 끝 ===

        // Use a deterministic generated ID for offline idempotency
        const docRef = doc(collection(db, 'driveLogs'));
        const expiresAt = new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000); // TTL: 5 years
        const finalData = sanitizeUndefined({ ...data, createdAt: serverTimestamp(), expiresAt });
        const promise = setDoc(docRef, finalData);

        if (isOffline) {
            import('../../offlineSync').then(({ queueOfflineAction }) => queueOfflineAction('CREATE_DRIVELOG', { ...data, id: docRef.id })).catch(() => console.warn('[offlineSync] CREATE_DRIVELOG 큐잉 실패'));
        }
        await promise;

        // 부가 작업(차량 계기판 갱신, 후속 기록 자동 보정)은 백그라운드에서 비동기 처리하여 응답성을 높임
        const runBackgroundUpdates = async () => {
            try {
                // 차량의 누적 Km 갱신 — 이 기록 이후에 같은 차량의 기록이 없을 때만
                const isEffectivelyRetroactive = data.isRetroactive ||
                    (data.organizationId && data.vehicleId && data.timestamp &&
                        await hasLaterDriveLog(data.organizationId, data.vehicleId, logDate));
                
                if (data.endKm && data.vehicleId && !isEffectivelyRetroactive) {
                    // 레이스 컨디션 방어: 단순 덮어쓰기가 아니라 이번 기록의 주행거리만큼 increment()
                    let distanceToAdd = 0;
                    if (data.distance != null) {
                        distanceToAdd = data.distance;
                    } else if (data.startKm != null && data.endKm != null) {
                        distanceToAdd = data.endKm - data.startKm;
                    }

                    if (distanceToAdd > 0) {
                        await updateDoc(doc(db, 'vehicles', data.vehicleId), {
                            currentKm: increment(distanceToAdd),
                        });
                    }
                }

                // 다음 기록의 startKm 자동 연동 (소급이든 아니든 항상 시도)
                if (data.endKm && data.vehicleId && data.organizationId && data.timestamp) {
                    await syncNextLogStartKm(data.organizationId, data.vehicleId, logDate, data.endKm);
                }
            } catch(err) {
                console.error('[createDriveLog] 백그라운드 작업 중 오류:', err);
                captureError(err, { context: 'createDriveLog_backgroundUpdate', data });
            }
        };

        // 즉시 실행하되 await 하지 않고 넘어가서 Fire-and-forget 처리 (빠른 응답)
        runBackgroundUpdates();

        return { 
            id: docRef.id, 
            syncResult: null, // 백그라운드로 빠졌으므로 동기적으로 결과를 반환하지 않음
            correctedStartKm: autocorrectedDistance ? correctedStartKm : undefined,
            oldStartKm: autocorrectedDistance ? originalStartKm : undefined
        };
    } catch (error) {
        // 중복 저장 방지 / 동기화 오류는 의도된 비즈니스 로직이므로 Sentry에 보고하지 않음
        const isBizError = error instanceof Error && (error.message.includes('중복') || error.message.includes('동기화 오류'));
        if (!isBizError) {
            captureError(error, { context: 'createDriveLog', data });
        }
        throw error;
    }
};

// 운행일지 수정
export const updateDriveLog = async (logId: string, data: Partial<DriveLog>) => {
    try {
        const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
        const finalData = sanitizeUndefined({ ...data, editedAt: serverTimestamp() });
        const promise = updateDoc(doc(db, 'driveLogs', logId), finalData);

        if (isOffline) {
            import('../../offlineSync').then(({ queueOfflineAction }) => queueOfflineAction('UPDATE_DRIVELOG', { ...data, id: logId })).catch(() => console.warn('[offlineSync] UPDATE_DRIVELOG 큐잉 실패'));
        }
        await promise; // 본체 갱신 완료까지는 기다림

        // 부가 작업 백그라운드 처리 (Fire-and-forget 방식)
        const runBackgroundUpdates = async () => {
            try {
                // endKm이 변경되고 vehicleId가 있으면 차량 currentKm 갱신
                if (data.endKm && data.vehicleId) {
                    await updateDoc(doc(db, 'vehicles', data.vehicleId), {
                        currentKm: data.endKm,
                    });
                }

                // endKm 변경 시 다음 기록의 startKm 자동 연동
                if (data.endKm && data.vehicleId && data.organizationId && data.timestamp) {
                    const logDate = data.timestamp instanceof Date ? data.timestamp : (data.timestamp as import("firebase/firestore").Timestamp).toDate ? (data.timestamp as import("firebase/firestore").Timestamp).toDate() : new Date();
                    await syncNextLogStartKm(data.organizationId, data.vehicleId, logDate, data.endKm);
                }
            } catch (err) {
                console.error('[updateDriveLog] 백그라운드 작업 중 오류:', err);
                captureError(err, { context: 'updateDriveLog_backgroundUpdate', logId, data });
            }
        };

        // await 하지 않고 위임 후 곧바로 리턴
        runBackgroundUpdates();

        return { syncResult: null }; // 백그라운드로 처리하므로 동기적으로 반환 안 얻음
    } catch (error) {
        captureError(error, { context: 'updateDriveLog', logId, data });
        throw error;
    }
};

// 운행일지 삭제
export const deleteDriveLog = async (logId: string) => {
    try {
        await deleteDoc(doc(db, 'driveLogs', logId));
    } catch (error) {
        captureError(error, { context: 'deleteDriveLog', logId });
        throw error;
    }
};
