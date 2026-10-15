import '@testing-library/jest-dom';
import { vi, beforeEach, afterEach, expect } from 'vitest';

// 전역 Mock: useAnalytics.ts에서 사용하는 통계 함수가 실제 DB에 접근하지 못하도록 차단
vi.mock('@/lib/firestore/statistics', () => ({
    getMonthlyStats: vi.fn().mockResolvedValue([]),
}));

// 전역 Mock: App Check — 단위 테스트가 실제 Google 서버에 접속하지 못하도록 차단
// lib/firebase.ts를 목 없이 불러오면 import만으로 App Check가 초기화된다. jsdom 주소가 localhost라
// 개발자 PC의 .env.local에 VITE_APPCHECK_DEBUG_TOKEN이 있으면 디버그 토큰 교환이
// content-firebaseappcheck.googleapis.com으로 나갔다(2026-10-16 실측). 늦게 온 응답이 다음 파일
// 실행 중에 터지고, 결과가 개발자 환경(.env.local)에 따라 달라진다. App Check 자체를 검증하는
// 단위 테스트는 없으므로(lib/firebase를 쓰는 테스트는 getAppCheckBlock을 직접 목으로 둔다) 전부 비운다.
vi.mock('firebase/app-check', () => ({
    initializeAppCheck: vi.fn(() => ({})),
    ReCaptchaV3Provider: class {},
    onTokenChanged: vi.fn(() => () => { }),
    getToken: vi.fn().mockResolvedValue({ token: 'test-app-check-token' }),
}));

// ── 외부 네트워크 가드 ─────────────────────────────────────────────
// 단위 테스트는 실제 서버에 접속하면 안 된다. 목이 빠지면 App Check 토큰 교환·Firestore gRPC가
// Google 서버로 나갔고(2026-10-16 실측, #496), 늦게 온 응답이 다른 파일 실행 중에 터졌다.
// 그래서 모든 TCP 연결의 입구인 net.Socket.prototype.connect를 감싸 루프백·유닉스 소켓 외의
// 주소는 그 자리에서 오류를 던지고, 위반을 기록해 afterEach에서 테스트를 실패시킨다
// (호출부가 오류를 catch로 삼켜도 기록으로 잡힌다).
// 소켓을 오류로 닫는 방식은 fetch(undici)가 error 리스너를 달기 전에 이벤트가 나가 처리되지 않은 오류가 됐다.
// - ESM 네임스페이스는 재할당이 안 되므로 CJS 객체를 패치한다 — 내장 모듈이라 워커 전체가 공유한다.
//   require 대신 process.getBuiltinModule(Node 22.3+)로 받는 이유: src의 tsconfig에는 Node 타입이 없고,
//   `node:module`을 import하려고 Node 타입을 전역에 넣으면 앱 코드의 setTimeout 등 타입까지 바뀐다.
// - vmThreads는 파일마다 setup이 다시 돌므로 process에 상태를 두고 패치는 한 번만 한다.
//   현재 파일 경로를 읽는 함수만 파일마다 갈아 끼운다(연결은 비동기라 다른 파일에서 터질 수 있어
//   시도 시점의 파일을 메시지에 남긴다).
// - Rules 테스트(tests/**)의 에뮬레이터는 127.0.0.1이라 영향이 없다.
interface NetGuardState {
    violations: string[];
    currentTest: () => string;
}
type ConnectFn = (this: unknown, ...args: unknown[]) => unknown;
declare const process: {
    getBuiltinModule(id: 'node:net'): { Socket: { prototype: { connect: ConnectFn } } };
} & Record<symbol, NetGuardState | undefined>;
const NET_GUARD_KEY = Symbol.for('vehicle-drive-log.netGuard');

function isLocalHost(host: unknown): boolean {
    if (host === undefined || host === null || host === '') return true; // 기본값 localhost
    const h = String(host).replace(/^\[|\]$/g, '').toLowerCase();
    return h === 'localhost' || h === '::1' || /^127\./.test(h) || /^::ffff:127\./.test(h);
}

/** Socket#connect 인자에서 원격 주소를 뽑는다. 로컬이면 null. */
function remoteTarget(args: unknown[]): string | null {
    // net.connect·tls.connect는 정규화된 배열([options, cb])로 넘긴다
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    if (first !== null && typeof first === 'object') {
        const opts = first as { path?: unknown; host?: unknown; port?: unknown };
        if (opts.path !== undefined) return null; // 유닉스 소켓·윈도 파이프
        return isLocalHost(opts.host) ? null : `${String(opts.host)}:${String(opts.port)}`;
    }
    if (typeof first === 'string' && !/^\d+$/.test(first)) return null; // connect(path)
    const host = typeof args[1] === 'string' ? args[1] : undefined;
    return isLocalHost(host) ? null : `${String(host)}:${String(first)}`;
}

let netGuard = process[NET_GUARD_KEY];
if (!netGuard) {
    const state: NetGuardState = { violations: [], currentTest: () => '(알 수 없음)' };
    netGuard = state;
    process[NET_GUARD_KEY] = state;
    const { Socket } = process.getBuiltinModule('node:net');
    const realConnect = Socket.prototype.connect;
    Socket.prototype.connect = function guardedConnect(...args: unknown[]) {
        const target = remoteTarget(args);
        if (target === null) return realConnect.apply(this, args);
        const caller = (new Error().stack ?? '').split('\n').slice(2, 8).join('\n');
        state.violations.push(`${target} ← ${state.currentTest()}\n${caller}`);
        throw new Error(`[테스트 네트워크 가드] 외부 연결 차단: ${target} — 실제 서버 접속은 vi.mock으로 막으세요`);
    };
}
netGuard.currentTest = () => {
    const { testPath, currentTestName } = expect.getState();
    return `${testPath ?? '(파일 모름)'} > ${currentTestName ?? '(테스트 밖)'}`;
};
const netViolations = netGuard.violations;

// ── '거짓 녹색' 가드 ──────────────────────────────────────────────
// 오류가 console.error로 삼켜져도 최종 단언이 통과하면 회귀를 놓친다.
// 그래서 "언제나 테스트 결함"인 두 패턴만 감지해 해당 테스트를 실패시킨다.
//   1) React act(...) 미적용 경고 — 비동기 상태 반영이 act 밖에서 일어남
//   2) vitest 누락 mock export — vi.mock에서 실제로 쓰는 export를 빠뜨림
// 정상 에러 경로 로깅(catch에서 의도적으로 찍는 console.error)은 그대로 통과시킨다.
// (blanket 차단은 이 코드베이스의 정상 에러 로깅 다수와 충돌해 채택하지 않음.)
const ALWAYS_BUG_PATTERNS: { re: RegExp; label: string }[] = [
    { re: /was not wrapped in act\(/, label: 'React act(...) 미적용 경고' },
    { re: /export is defined on the .+? mock/, label: 'vitest 누락 mock export' },
];

const realConsoleError = console.error.bind(console);
let consoleViolations: string[] = [];

function guardedConsoleError(...args: unknown[]) {
    const msg = args
        .map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a)))
        .join(' ');
    const hit = ALWAYS_BUG_PATTERNS.find((p) => p.re.test(msg));
    if (hit) consoleViolations.push(`[${hit.label}] ${msg.slice(0, 200)}`);
    realConsoleError(...args);
}

beforeEach(() => {
    consoleViolations = [];
    console.error = guardedConsoleError;
});

afterEach(() => {
    const found = consoleViolations;
    consoleViolations = [];
    console.error = realConsoleError;
    const blocked = netViolations.splice(0);
    if (blocked.length > 0) {
        throw new Error(
            `외부 네트워크 연결 ${blocked.length}건 차단 — 단위 테스트는 실제 서버에 접속하면 안 됩니다. ` +
            `접속하는 모듈(firebase/firestore·fetch 등)을 vi.mock으로 막으세요.\n` +
            `(연결은 비동기라 시도한 파일이 지금 실패한 파일과 다를 수 있습니다 — 각 항목의 '←' 뒤가 시도 시점입니다)\n  - ${blocked.join('\n  - ')}`,
        );
    }
    if (found.length > 0) {
        throw new Error(
            `테스트 품질 위반 ${found.length}건 — '거짓 녹색'을 유발하는 항상-버그 패턴입니다:\n  - ${found.join('\n  - ')}`,
        );
    }
});