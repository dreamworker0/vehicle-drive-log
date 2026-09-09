/**
 * 운전자 경로 청크 워밍 — 프리캐시에서 뺀 것을 **로그인 후에** 채운다.
 *
 * ## 왜 필요한가
 * 프리캐시가 앱 셸만 담도록 좁혀졌다(vite.config.js 주석 참고). 덕분에 비로그인 방문
 * 1회가 1.14MB → 0.2MB로 내려갔지만, 그 대가로 라우트 청크는 **방문한 것만** 캐시된다.
 * 운전자가 사무실에서 앱을 열었다가 지하 주차장(오프라인)에서 운행일지를 쓰려 하면,
 * 그 화면을 아직 한 번도 열지 않았다면 청크가 없어 실패한다.
 *
 * 그래서 운전자 셸에 들어온 시점에 운전자 경로 청크를 미리 받아 둔다. 서비스 워커의
 * `/assets/` 런타임 캐시(sw.ts)가 이 요청들을 그대로 담으므로, 이후에는 오프라인에서도
 * 열린다. **오프라인 보장 대상은 운전자 경로뿐이다** — 관리자·슈퍼관리자·통계·엑셀
 * 내보내기 화면은 워밍하지 않는다. 이 목록에 그 화면들을 추가하면 프리캐시를 좁힌
 * 효과가 그만큼 사라진다.
 *
 * ## 호출 위치
 * `EmployeeLayout` 마운트 시 한 번. 그 자리가 곧 "운전자 경로에 들어왔다"는 뜻이고,
 * 슈퍼관리자 화면에서는 마운트되지 않으므로 역할 판정을 따로 둘 필요가 없다.
 * (관리자가 직원 모드로 전환한 경우에도 마운트되므로 그때는 함께 워밍된다 — 관리자도
 *  현장에서 운전하므로 의도된 동작이다.)
 */

/**
 * 워밍 대상 — `EmployeeLayout`이 지연 로딩하는 화면과 **같은 모듈 지정자**를 쓴다.
 * 지정자가 같아야 Rollup이 같은 청크로 묶어 워밍이 실제 내비게이션에 재사용된다.
 * 경로를 바꿀 때는 EmployeeLayout의 `lazyWithRetry` 목록과 함께 고친다.
 */
const DRIVER_ROUTE_LOADERS: Array<() => Promise<unknown>> = [
    () => import('../components/employee/TodayDashboard'),
    () => import('../components/employee/DriveLogForm'),
    () => import('../components/employee/QuickDriveStart'),
    () => import('../components/employee/FuelLogTab'),
    () => import('../components/employee/MyRecords'),
    () => import('../components/common/ReservationCalendar'),
    () => import('../components/employee/FavoritesManager'),
    () => import('../components/employee/VehicleHistory'),
    () => import('../components/employee/MorePage'),
];

/** 워밍은 세션당 한 번이면 된다 — 두 번째부터는 브라우저 모듈 캐시가 받아 준다. */
let started = false;

/** 현재 화면의 로딩과 다투지 않도록 유휴 시점까지 미룬다. */
const WARM_DELAY_MS = 2_000;

function scheduleIdle(run: () => void): void {
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
        .requestIdleCallback;
    if (typeof ric === 'function') {
        ric(run, { timeout: 10_000 });
        return;
    }
    setTimeout(run, WARM_DELAY_MS);
}

/**
 * 데이터 절약 모드면 워밍하지 않는다.
 *
 * 현장 저사양 폰·종량제 회선에서 "지금 쓰지 않는 화면"을 미리 받는 것은 사용자가 명시적으로
 * 거부한 종류의 트래픽이다. 오프라인 보장을 포기하는 대신 데이터를 아끼는 쪽을 택한다 —
 * 실제 내비게이션에서는 그때 받으므로 기능이 막히지는 않는다.
 */
function prefersLessData(): boolean {
    const conn = (navigator as { connection?: { saveData?: boolean } }).connection;
    return conn?.saveData === true;
}

/**
 * 운전자 경로 청크를 순차로 미리 받는다. 실패는 무시한다 —
 * 실제 내비게이션은 `lazyWithRetry`가 재시도로 처리하므로 여기서 알릴 것이 없다.
 *
 * **순차인 이유**: 병렬로 9개를 던지면 느린 회선에서 현재 화면의 데이터 요청과 대역폭을
 * 다툰다. 워밍은 급하지 않으므로 한 번에 하나씩 받는다.
 */
export function warmDriverRoutes(): void {
    if (started) return;
    // 오프라인이면 지금 받을 수 없다. started를 세우지 않고 돌아가 다음 마운트에서 다시 시도한다.
    if (navigator.onLine === false) return;
    if (prefersLessData()) return;

    started = true;

    scheduleIdle(async () => {
        /*
         * 판정과 실행 사이에 최대 10초가 있다. 그 사이 엘리베이터·지하로 들어가 통신이
         * 끊기면 9건이 전부 실패하는데, `started`가 이미 true라 그 세션에서는 다시 시도하지
         * 않는다 — 통신이 돌아와도 오프라인 보장이 없는 채로 남는다. 그래서 실행 직전에
         * 다시 확인하고, 못 받았으면 플래그를 되돌려 다음 마운트에 기회를 남긴다.
         */
        if (navigator.onLine === false) {
            started = false;
            return;
        }

        let loaded = 0;
        for (const load of DRIVER_ROUTE_LOADERS) {
            try {
                await load();
                loaded += 1;
            } catch {
                // 한 청크가 실패해도 나머지는 계속 받는다.
            }
        }

        // 한 건도 못 받았으면 회선이 끊긴 것으로 보고 재시도 여지를 남긴다.
        if (loaded === 0) started = false;
    });
}

/** 테스트 전용 — 모듈 스코프의 1회 실행 플래그를 되돌린다. */
export function __resetWarmDriverRoutesForTest(): void {
    started = false;
}
