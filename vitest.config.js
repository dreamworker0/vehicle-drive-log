import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// 로컬 테스트 워커 상한 — 강의·화면공유·브라우저 등 다른 작업과 동시에 돌려도
// CPU가 꽉 차 끊기지 않도록 여유를 남긴다(기본 코어의 25%, 16코어 기준 4개).
// CI(전용 러너)에서는 제한 없이 최대 병렬로 돌린다. 더 빠르게/느리게는
// VITEST_MAX_WORKERS 로 조정(숫자 예: 8, 또는 백분율 예: '50%').
const rawWorkers = process.env.VITEST_MAX_WORKERS;
const localMaxWorkers = rawWorkers
    ? (rawWorkers.includes('%') ? rawWorkers : Number(rawWorkers))
    : '25%';

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    test: {
        env: {
            // 예약·운행 시각 로직은 KST 전제 — 호스트 시간대(UTC 등)에 따라 결과가
            // 달라지지 않도록 고정한다. CI 워크플로의 TZ와 동일하게 맞춘 값.
            TZ: 'Asia/Seoul',
            VITE_FIREBASE_API_KEY: 'test-api-key',
            VITE_FIREBASE_AUTH_DOMAIN: 'test.firebaseapp.com',
            VITE_FIREBASE_PROJECT_ID: 'test-project',
            VITE_FIREBASE_STORAGE_BUCKET: 'test-project.appspot.com',
            VITE_FIREBASE_MESSAGING_SENDER_ID: '123456789012',
            VITE_FIREBASE_APP_ID: '1:123456789012:web:1234567890abcdef',
            VITE_FIREBASE_MEASUREMENT_ID: 'G-TEST123456',
        },
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./src/__tests__/setup.ts'],
        // 로컬은 워커 상한으로 CPU 여유 확보, CI는 기본값(최대 병렬)
        maxWorkers: process.env.CI ? undefined : localMaxWorkers,
        minWorkers: process.env.CI ? undefined : 1,
        exclude: [
            '**/node_modules/**',
            '**/e2e/**',
            '**/functions/**',
            // git 워크트리(.worktrees/*)는 다른 브랜치의 중첩 체크아웃 — 부모 런이 스캔하면 안 된다
            '**/.worktrees/**',
            // 에뮬레이터 없이 도는 일반 유닛 런/lint-staged에서는 rules 테스트를 제외한다.
            // (해당 에뮬레이터 실행 시에만 호스트 env가 세팅되어 포함됨)
            ...(!process.env.FIRESTORE_EMULATOR_HOST ? ['tests/firestore-rules.test.ts'] : []),
            ...(!process.env.FIREBASE_STORAGE_EMULATOR_HOST ? ['tests/storage-rules.test.ts'] : [])
        ],
        coverage: {
            provider: 'v8',
            // json-summary는 CI 아티팩트(coverage-summary.json) 업로드용
            reporter: ['text', 'text-summary', 'json', 'json-summary', 'lcov', 'html'],
            // 실측(2026-07-25: lines 32.46/stmts 31.51/funcs 25.27/branches 22.37) 기준
            // 후퇴 방지선(안전 마진 ~1pp). 목표는 숫자가 아니라 회귀 차단 — 테스트 추가에 맞춰 단계 상향.
            // 2026-07-10 임계경로 테스트(syncQueue·auth·예약 제출) 추가로 하한 상향.
            // 2026-07-25 출력물·경로 계산 테스트(lib/pdf 5%→97%, lib/tmap 16%→97%) 추가로 재상향.
            thresholds: {
                lines: 31,
                statements: 30,
                functions: 24,
                branches: 21
            },
            include: ['src/**/*.{ts,tsx}'],
            exclude: [
                'src/__tests__/**',
                'src/types/**',
                'src/main.tsx',
                'src/sw.ts',
                'src/vite-env.d.ts',
                'src/components/common/UpdatePrompt.tsx',
                'src/components/common/InstallPrompt.tsx',
                'src/components/common/IOSInstallPrompt.tsx',
            ],
        },
    },
});
