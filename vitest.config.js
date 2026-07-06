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
            // 실측(2026-07-06: lines 26.57/stmts 25.56/funcs 20.43/branches 15.79) 기준
            // 후퇴 방지선. 목표는 숫자가 아니라 회귀 차단 — 테스트 추가에 맞춰 단계 상향.
            thresholds: {
                lines: 26,
                statements: 25,
                functions: 20,
                branches: 15
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
