import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import { toKSTDate } from '../utils/kstDate';

/**
 * 매월 1일 자정(KST), 차량별 지난달 기록을 체크하여 마일리지(누적 주행거리) 불일치가 있는지 검증하는 데몬 함수.
 * 데이터 무결성을 위해 백그라운드 환경에서 정기적으로 실행됩니다.
 */
export const verifyMileageConsistency = onSchedule(
    { schedule: '0 0 1 * *', timeZone: 'Asia/Seoul', timeoutSeconds: 540 },
    async (event) => {
        const db = admin.firestore();
        const organizationsSnap = await db.collection('organizations').get();

        const latestMonth = toKSTDate();
        latestMonth.setMonth(latestMonth.getMonth() - 1);
        const y = latestMonth.getFullYear();
        const m = latestMonth.getMonth() + 1;
        const targetMonthPrefix = `${y}-${String(m).padStart(2, '0')}`; // 예: '2026-03'

        console.log(`[verifyMileageConsistency] 검증 시작 대상 기간: ${targetMonthPrefix}`);

        let totalInconsistencies = 0;

        for (const orgDoc of organizationsSnap.docs) {
            const orgId = orgDoc.id;
            const vehiclesSnap = await db.collection(`organizations/${orgId}/vehicles`).get();

            for (const vehicleDoc of vehiclesSnap.docs) {
                const vehicleId = vehicleDoc.id;

                // 시작 마일리지 기준 역순으로 정렬 (운행일지는 순차 입력된다는 전제)
                const logsSnap = await db.collection(`organizations/${orgId}/driveLogs`)
                    .where('vehicleId', '==', vehicleId)
                    .orderBy('startKm', 'desc')
                    .get();

                if (logsSnap.empty || logsSnap.docs.length < 2) continue;

                const logs = logsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

                // logs: [1000~1050, 950~1000, 900~950] (startKm 내림차순)
                for (let i = 0; i < logs.length - 1; i++) {
                    const latestLog = logs[i];       // 최신 (예: 1000 ~ 1050)
                    const previousLog = logs[i + 1]; // 과거 (예: 950 ~ 1000)

                    // 과거 로그의 도착 거리(endKm)와 최신 로그의 출발 거리(startKm)가 다르면 오차 발생
                    if (previousLog.endKm !== latestLog.startKm) {
                        console.warn(`[Mileage Inconsistency] 차량: ${vehicleId}`);
                        console.warn(`- 과거 로그(${previousLog.id}): ${previousLog.startKm} -> ${previousLog.endKm}`);
                        console.warn(`- 이후 로그(${latestLog.id}): ${latestLog.startKm} -> ${latestLog.endKm}`);
                        totalInconsistencies++;
                        
                        // 향후 기관 관리자 알림(Notification) 추가 가능 지점
                        /*
                        await db.collection(`organizations/${orgId}/notifications`).add({
                           type: 'MILEAGE_GAP',
                           vehicleId,
                           message: `마일리지 기록 불일치가 감지되었습니다. (${previousLog.endKm}km -> ${latestLog.startKm}km)`,
                           createdAt: admin.firestore.FieldValue.serverTimestamp(),
                           read: false
                        });
                        */
                    }
                }
            }
        }
        
        console.log(`[verifyMileageConsistency] 검증 완료. 총 불일치 발견: ${totalInconsistencies}건`);
    }
);
