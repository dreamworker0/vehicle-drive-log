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
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./src/__tests__/setup.ts'],
        exclude: ['**/node_modules/**', '**/e2e/**', '**/functions/**'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'text-summary', 'json', 'lcov'],
            thresholds: {
                lines: 20,
                statements: 20,
                functions: 15,
                branches: 10
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
