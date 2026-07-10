import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    test: {
        env: {
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
        exclude: [
            '**/node_modules/**',
            '**/e2e/**',
            '**/functions/**',
            ...(!process.env.FIRESTORE_EMULATOR_HOST ? ['tests/firestore-rules.test.ts'] : [])
        ],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'text-summary', 'json', 'lcov', 'html'],
            // 실측(2026-07-10: lines 29.12/stmts 27.89/funcs 21.88/branches 17.83) 기준
            // 후퇴 방지선(안전 마진 ~1pp). 목표는 숫자가 아니라 회귀 차단 — 테스트 추가에 맞춰 단계 상향.
            // 2026-07-10 임계경로 테스트(syncQueue·auth·예약 제출) 추가로 하한 상향.
            thresholds: {
                lines: 28,
                statements: 27,
                functions: 21,
                branches: 17
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
