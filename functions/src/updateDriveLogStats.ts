import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

/**
 * 운행일지 추가/수정/삭제 시 기관의 월별 집계(월별 운행건수, 누적거리)를 자동으로 업데이트합니다.
 * 이를 통해 클라이언트에서 수백 건의 일지를 매번 읽어오지 않도록 비용(Read)을 최적화(역정규화)합니다.
 */
export const updateDriveLogStats = functions
    .region('asia-northeast3')
    .firestore.document('organizations/{orgId}/driveLogs/{logId}')
    .onWrite(async (change, context) => {
        const { orgId } = context.params;
        const db = admin.firestore();

        // 새 데이터와 이전 데이터
        const beforeData = change.before.exists ? change.before.data() : null;
        const afterData = change.after.exists ? change.after.data() : null;

        const isCreate = !beforeData && afterData;
        const isDelete = beforeData && !afterData;
        const isUpdate = beforeData && afterData;

        // 타겟 월 (YYYY-MM) 산출: 작성된 일지의 운행 날짜를 기준 (문법 편의상 시작/종료일 중 시작일 기준)
        const getMonthId = (dateStr?: string) => {
            if (!dateStr || dateStr.length < 7) {
                const now = new Date();
                const year = now.getFullYear();
                const month = String(now.getMonth() + 1).padStart(2, '0');
                return `${year}-${month}`;
            }
            return dateStr.substring(0, 7); // yyyy-MM
        };

        const targetMonthId = getMonthId(afterData?.startDateTime || beforeData?.startDateTime);
        const statsRef = db.collection('organizations').doc(orgId).collection('monthlyStats').doc(targetMonthId);

        let runsDelta = 0;
        let distanceDelta = 0;

        if (isCreate && afterData) {
            runsDelta = 1;
            distanceDelta = Number(afterData.distance) || 0;
        } else if (isDelete && beforeData) {
            runsDelta = -1;
            distanceDelta = -(Number(beforeData.distance) || 0);
        } else if (isUpdate && beforeData && afterData) {
            // 변경된 값의 차이만큼 올리거나 내림
            // 단, 운행 삭제 없이 변경만 된 것이므로 횟수는 변화 없음
            const beforeDist = Number(beforeData.distance) || 0;
            const afterDist = Number(afterData.distance) || 0;
            distanceDelta = afterDist - beforeDist;
            
            // 날짜(월)가 변경된 경우의 처리는 매우 복잡해지므로(이전 월 삭감, 새 월 증가) 
            // 현재 버전에서는 단순 계산만 지원하고 필요시 확장.
            const beforeMonth = getMonthId(beforeData.startDateTime);
            const afterMonth = getMonthId(afterData.startDateTime);
            
            if (beforeMonth !== afterMonth) {
                // 월이 바뀐 수정 케이스 (이전 달에서 빼고, 이번 달에 넣기)
                const batch = db.batch();
                batch.set(db.collection('organizations').doc(orgId).collection('monthlyStats').doc(beforeMonth), {
                    totalRuns: admin.firestore.FieldValue.increment(-1),
                    totalDistance: admin.firestore.FieldValue.increment(-beforeDist)
                }, { merge: true });
                
                batch.set(db.collection('organizations').doc(orgId).collection('monthlyStats').doc(afterMonth), {
                    totalRuns: admin.firestore.FieldValue.increment(1),
                    totalDistance: admin.firestore.FieldValue.increment(afterDist)
                }, { merge: true });
                
                return batch.commit();
            }
        }

        if (runsDelta === 0 && distanceDelta === 0) {
            return null; // 변동 없음
        }

        return statsRef.set({
            totalRuns: admin.firestore.FieldValue.increment(runsDelta),
            totalDistance: admin.firestore.FieldValue.increment(distanceDelta),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    });
