/**
 * 운전자 경로 워밍의 계약을 고정한다.
 *
 * 프리캐시를 앱 셸로 좁힌 뒤(vite.config.js), 운전자 경로의 오프라인은 **이 워밍에만**
 * 달려 있다. 그래서 두 방향을 모두 고정한다.
 *  - 워밍이 조용히 죽으면 → 지하 주차장에서 운행일지 화면이 열리지 않는다.
 *  - 워밍 목록이 EmployeeLayout의 라우트와 어긋나면 → 새로 추가된 운전자 화면만 오프라인에서
 *    빠지고, 그 사실은 현장에서야 드러난다. 목록 대조 테스트가 그 드리프트를 잡는다.
 *
 * ## 관측 지점을 `requestIdleCallback`으로 둔 이유
 * 처음엔 `vi.mock` 팩토리에서 로드된 모듈을 기록해 셌는데, ESM 모듈 레지스트리는 첫 로드
 * 이후 팩토리를 다시 평가하지 않는다 — 두 번째 테스트부터 기록이 비어 실패했다. 실행 여부의
 * 계약은 "워밍을 예약했는가"이므로 스케줄러를 관측한다. 무엇을 받는지는 아래 목록 대조
 * 테스트와 `warmsEveryDriverRoute`가 함께 보장한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Vite의 ?raw는 vite/client 타입(src/vite-env.d.ts)으로 이미 string으로 잡힌다.
import LAYOUT_SOURCE from '../../components/employee/EmployeeLayout.tsx?raw';
import WARM_SOURCE from '../../lib/warmDriverRoutes.ts?raw';

// 워밍이 실제 화면 모듈(firebase 등)을 끌어오지 않도록 대상 9종을 전부 대체한다.
const { loadedModules } = vi.hoisted(() => ({ loadedModules: [] as string[] }));
const stub = (name: string) => { loadedModules.push(name); return { default: () => null }; };

vi.mock('../../components/employee/TodayDashboard', () => stub('TodayDashboard'));
vi.mock('../../components/employee/DriveLogForm', () => stub('DriveLogForm'));
vi.mock('../../components/employee/QuickDriveStart', () => stub('QuickDriveStart'));
vi.mock('../../components/employee/FuelLogTab', () => stub('FuelLogTab'));
vi.mock('../../components/employee/MyRecords', () => stub('MyRecords'));
vi.mock('../../components/common/ReservationCalendar', () => stub('ReservationCalendar'));
vi.mock('../../components/employee/FavoritesManager', () => stub('FavoritesManager'));
vi.mock('../../components/employee/VehicleHistory', () => stub('VehicleHistory'));
vi.mock('../../components/employee/MorePage', () => stub('MorePage'));

import { warmDriverRoutes, __resetWarmDriverRoutesForTest } from '../../lib/warmDriverRoutes';

/** 워밍이 예약을 맡기는 자리 — 호출 여부가 곧 "워밍했는가"다. */
let idleSpy: ReturnType<typeof vi.fn>;

/** navigator.onLine / connection.saveData를 이 테스트 안에서만 바꾼다. */
function setNetwork({ online = true, saveData = false }: { online?: boolean; saveData?: boolean }) {
    Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
    Object.defineProperty(navigator, 'connection', { value: { saveData }, configurable: true });
}

/** 예약된 워밍을 실제로 실행한다. */
async function runScheduled() {
    for (const [cb] of idleSpy.mock.calls) await (cb as () => Promise<void>)();
}

beforeEach(() => {
    __resetWarmDriverRoutesForTest();
    idleSpy = vi.fn();
    Object.defineProperty(globalThis, 'requestIdleCallback', { value: idleSpy, configurable: true });
    setNetwork({});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('warmDriverRoutes', () => {
    it('온라인·정상 회선이면 워밍을 예약하고, 호출 직후에는 아무것도 받지 않는다', () => {
        warmDriverRoutes();

        // 유휴 시점까지 미룬다 — 현재 화면의 로딩과 대역폭을 다투지 않기 위한 의도된 지연이다.
        expect(idleSpy).toHaveBeenCalledTimes(1);
        expect(loadedModules).toEqual([]);
    });

    it('예약이 실행되면 운전자 경로 모듈을 받는다', async () => {
        warmDriverRoutes();
        await runScheduled();

        // 모듈 레지스트리는 첫 로드만 팩토리를 평가하므로 개수가 아니라 "받았는가"를 본다.
        // 어떤 화면이 대상인지는 아래 목록 대조 테스트가 고정한다.
        expect(loadedModules.length).toBeGreaterThan(0);
        expect(loadedModules).toContain('DriveLogForm');
    });

    it('오프라인이면 예약하지 않고, 온라인이 되면 다시 시도한다', () => {
        setNetwork({ online: false });
        warmDriverRoutes();
        expect(idleSpy).not.toHaveBeenCalled();

        // 오프라인 시도에서 1회 실행 플래그를 세워 버리면 그 세션은 영영 워밍되지 않는다.
        setNetwork({ online: true });
        warmDriverRoutes();
        expect(idleSpy).toHaveBeenCalledTimes(1);
    });

    it('데이터 절약 모드면 예약하지 않는다', () => {
        setNetwork({ saveData: true });
        warmDriverRoutes();
        expect(idleSpy).not.toHaveBeenCalled();
    });

    it('여러 번 불려도 한 번만 예약한다', () => {
        warmDriverRoutes();
        warmDriverRoutes();
        warmDriverRoutes();
        expect(idleSpy).toHaveBeenCalledTimes(1);
    });

    it('requestIdleCallback이 없는 환경에서도 예약된다', () => {
        Object.defineProperty(globalThis, 'requestIdleCallback', { value: undefined, configurable: true });
        const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');

        warmDriverRoutes();

        expect(timeoutSpy).toHaveBeenCalled();
    });

    it('워밍 목록이 EmployeeLayout의 지연 로드 라우트와 일치한다', () => {
        // EmployeeLayout의 `lazyWithRetry(() => import('...'))`에서 모듈 이름만 뽑는다.
        const routeModules = [...LAYOUT_SOURCE.matchAll(/lazyWithRetry\(\(\)\s*=>\s*import\('([^']+)'\)\)/g)]
            .map(m => m[1].split('/').pop() as string);
        expect(routeModules.length).toBeGreaterThan(0); // 추출 규칙이 죽으면 통과시키지 않는다

        const warmed = [...WARM_SOURCE.matchAll(/import\('([^']+)'\)/g)].map(m => m[1].split('/').pop() as string);

        // 빠짐: 새 운전자 화면이 오프라인에서만 열리지 않는 상태가 된다.
        const missing = routeModules.filter(m => !warmed.includes(m));
        expect(missing, `오프라인 워밍에서 빠진 운전자 화면: ${missing.join(', ')}`).toEqual([]);

        // 덧붙음: 운전자 경로가 아닌 청크를 워밍하면 프리캐시를 좁힌 효과가 그만큼 사라진다.
        // 오프라인 보장 대상은 운전자 경로뿐이라는 결정을 여기서 지킨다.
        const extra = warmed.filter(m => !routeModules.includes(m));
        expect(extra, `운전자 경로가 아닌데 워밍 목록에 있음: ${extra.join(', ')}`).toEqual([]);
    });
});
