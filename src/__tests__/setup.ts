import '@testing-library/jest-dom';
import { vi, beforeEach, afterEach } from 'vitest';

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
    if (found.length > 0) {
        throw new Error(
            `테스트 품질 위반 ${found.length}건 — '거짓 녹색'을 유발하는 항상-버그 패턴입니다:\n  - ${found.join('\n  - ')}`,
        );
    }
});