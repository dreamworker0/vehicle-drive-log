import '@testing-library/jest-dom';
import { vi, beforeEach, afterEach } from 'vitest';

// 전역 Mock: useAnalytics.ts에서 사용하는 통계 함수가 실제 DB에 접근하지 못하도록 차단
vi.mock('@/lib/firestore/statistics', () => ({
    getMonthlyStats: vi.fn().mockResolvedValue([]),
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