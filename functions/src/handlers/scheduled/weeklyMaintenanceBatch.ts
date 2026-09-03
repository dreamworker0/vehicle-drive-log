/**
 * weeklyMaintenanceBatch — 매주 일요일 03:00(KST) 유지보수 배치
 *
 * 1. purgeOrgs: soft-deleted 기관 30일 경과 시 영구 삭제
 * 2. cleanupImages: 승인·반려 후 30일 경과 기관의 증빙 이미지 삭제
 * 3. archiveLogs: 3년 이상 된 운행 기록을 GCS로 아카이빙 후 삭제
 *
 * ## 왜 주 1회인가
 * 셋 다 판정 기준이 **30일·3년**이다. 매일 돌려도 어제와 오늘의 대상이 사실상 같고,
 * 하루 늦게 처리해도 규정·용량 어느 쪽에도 영향이 없다. 매일 도는 동안에는 대상이 없는
 * 날에도 기관 전수 쿼리와 GCS 존재 확인이 그대로 나갔다.
 *
 * ⚠️ archiveLogs는 한 번에 500건까지만 아카이빙한다(원본 그대로 유지). 즉 밀린 기록이
 * 500건을 넘으면 소진 속도가 하루 500건 → 주 500건으로 느려진다. 3년 경과 기록이 대량으로
 * 쌓여 있는 상황이라면 이 스케줄을 일시적으로 매일로 되돌리거나 limit을 올릴 것.
 *
 * `retryCount: 0` — 셋 다 멱등하지만(대상이 남아 있으면 다음 주에 다시 처리) 삭제를 포함하므로
 * 자동 재실행으로 이득을 볼 구간이 없다. (rules/cloud-functions.md §3.1)
 */
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { purgeOrgs, cleanupImages, archiveLogs } from "./dailyNightlyBatch";
import { runStep, logBatchResult } from "../../utils/batchStep";

const CONTEXT = "weeklyMaintenanceBatch";

export const weeklyMaintenanceBatch = onSchedule(
    {
        schedule: "0 3 * * 0", // KST 일요일 03:00 (야간 배치들과 시간대를 겹치지 않게 둔다)
        timeZone: "Asia/Seoul",
        retryCount: 0,
        memory: "512MiB",
        timeoutSeconds: 540,
    },
    async function () {
        const db = getFirestore();
        const bucket = getStorage().bucket();

        const failed: string[] = [];

        await runStep(failed, CONTEXT, "purgeOrgs", () => purgeOrgs(db));
        await runStep(failed, CONTEXT, "cleanupImages", () => cleanupImages(db, bucket));
        await runStep(failed, CONTEXT, "archiveLogs", () => archiveLogs(db, bucket));

        await logBatchResult(CONTEXT, failed);
    }
);
