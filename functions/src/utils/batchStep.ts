/**
 * batchStep — 배치 스텝 하나를 실행하는 공용 래퍼
 *
 * 야간 배치를 성격별로 셋(집계·백업·주간 유지보수)으로 쪼개면서, 세 배치가 같은 실패 처리
 * 규약을 공유하도록 dailyNightlyBatch에 있던 runStep을 여기로 옮겼다. `context`만 배치별로
 * 다르게 넘긴다.
 */
import { captureError, flushSentry } from "../core/sentry";

/**
 * 배치 스텝 하나를 실행한다. 실패해도 다음 스텝으로 넘어가되, **조용히 넘어가지는 않는다.**
 *
 * 각 스텝의 catch가 console.error만 남기면 어디로도 알림이 가지 않아, 특히 Firestore 백업
 * 실패가 "매일 눈으로 확인"(OPERATIONS.md)에만 의존하게 된다 — 백업은 실패한 사실 자체를
 * 놓치면 복구 시점에야 알게 되는 항목이다. captureError로 승격해 Sentry·Discord로 즉시 드러낸다.
 *
 * 스텝 단위로만 승격하는 것이 요점이다. 기관별 루프 내부(purgeOrgs 등)의 개별 실패까지
 * 올리면 한 번의 배치가 알림 수십 건을 쏟아낸다 — 그쪽은 console.error로 남긴다.
 */
export async function runStep(
    failed: string[],
    context: string,
    name: string,
    fn: () => Promise<unknown>,
): Promise<void> {
    try {
        await fn();
    } catch (e: unknown) {
        console.error(`Error in ${name}:`, (e as Error).message);
        captureError(e, { context, step: name });
        failed.push(name);
    }
}

/**
 * 배치 종료 처리 — 결과를 한 줄로 남기고, 스텝들이 남긴 보고를 전송한다.
 * 실패 스텝이 있으면 error로 올린다.
 *
 * **flush가 여기 있는 이유**: Sentry 전송은 비동기라 핸들러가 반환하면 Cloud Run 인스턴스가
 * 동결·종료되면서 버퍼가 그대로 사라진다. HTTPS·콜러블은 utils/helpers의
 * wrapHttps·wrapCallableHandler가 경계에서 flush하지만 **스케줄 함수는 그 래퍼를 거치지 않는다.**
 * 그러면 runStep이 captureError로 올린 백업 실패가 전송 전에 없어져, 승격해 둔 의미가 사라진다.
 * 세 배치가 모두 마지막에 이 함수를 부르므로 여기가 공통 경계다 — 호출부는 반드시 await 한다.
 */
export async function logBatchResult(context: string, failed: string[]): Promise<void> {
    if (failed.length > 0) {
        console.error(`[Batch] ${context} completed with ${failed.length} failed step(s): ${failed.join(", ")}`);
    } else {
        console.log(`[Batch] ${context} completed.`);
    }
    await flushSentry();
}
