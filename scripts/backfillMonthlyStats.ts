/**
 * 월별 집계(orgStats/{orgId}/monthly) 소급 재집계 — 운영 스크립트
 *
 * ## 왜 필요한가
 * 야간 배치(runDailyAggregation)는 당월(월초에는 전월까지)과, 트리거·배치가 "재집계 필요"로 표시한
 * 달만 다시 계산한다. 표시가 닿지 않는 경우에는 과거 달을 한꺼번에 다시 계산해야 한다:
 *   - 집계 방식(공식) 자체를 바꿨을 때
 *   - 1년보다 오래된 달, 비용 기록(주유·하이패스·정비) 삭제
 *
 * 예전에는 같은 일을 하는 슈퍼관리자 콜러블 `backfillMonthlyStats`가 운영에 배포돼 있었다.
 * 화면 어디서도 부르지 않는 일회성 도구라 공개 엔드포인트를 걷어내고 여기로 옮겼다
 * (2026-11-25, 외부 리뷰 P3-14). 계산은 같은 함수(runDailyAggregation)를 그대로 쓴다.
 *
 * ## 사용법 (firebase-admin·functions 의존성은 functions/node_modules에서 읽는다)
 *   cd functions            (Windows PowerShell 5.1은 `&&`를 지원하지 않는다 — 한 줄씩 또는 `;`로 잇는다)
 *   npx tsx ../scripts/backfillMonthlyStats.ts                       # 대상 프로젝트·개월 수만 출력 (기본, 쓰지 않음)
 *   npx tsx ../scripts/backfillMonthlyStats.ts --apply               # 최근 6개월 재집계
 *   npx tsx ../scripts/backfillMonthlyStats.ts --apply --months=12   # 최근 12개월 (1~24)
 *
 * ## 안전장치
 * - 기본은 아무것도 쓰지 않는다. `--apply`가 있어야 실행한다.
 * - 대상 프로젝트는 lib/adminApp이 고정하고 첫 줄에 출력한다 — 반드시 확인한다.
 * - set(merge)라 멱등하다. 중간에 끊겨도 다시 실행하면 된다.
 *
 * ## 비용
 * 기관마다 그 기간의 운행일지·주유·하이패스·정비를 읽는다. 6개월이면 대략 야간 배치 몇 번 분량이다.
 */
import { initAdminApp, initFunctionsAdminApp } from './lib/adminApp';
import { parseBackfillMonths } from './lib/backfillMonths';

const apply = process.argv.includes('--apply');
const months = parseBackfillMonths(process.argv);

async function main(): Promise<void> {
    initAdminApp(); // 대상 프로젝트를 첫 줄에 출력한다
    console.log(`재집계 범위: 최근 ${months}개월`);
    if (!apply) {
        console.log('\n조회만 했다 — 실행하려면 --apply를 붙인다.');
        return;
    }

    // dailyAggregation은 모듈을 불러오는 순간 getFirestore()를 부른다 — functions 쪽 firebase-admin
    // 사본에도 앱을 만든 뒤에 불러온다(lib/adminApp의 initFunctionsAdminApp 설명 참고).
    initFunctionsAdminApp();
    const { runDailyAggregation } = await import('../functions/src/handlers/scheduled/dailyAggregation');
    const startedAt = Date.now();
    const summary = await runDailyAggregation(months);
    const sec = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`\n완료 (${sec}초) — 기관 ${summary.orgs}, 성공 ${summary.processed}, 실패 ${summary.errors}`);
    console.log(`대상 월: ${summary.months.join(', ')}`);
    if (summary.errors > 0) {
        console.error('일부 기관 집계에 실패했다 — 같은 명령으로 다시 실행하면 된다(멱등).');
        process.exitCode = 1;
    }
}

main().catch((err: unknown) => {
    console.error('실패:', err);
    process.exitCode = 1;
});
