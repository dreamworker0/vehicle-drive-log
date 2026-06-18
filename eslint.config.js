import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import requireOrganizationFilter from './eslint-rules/require-organization-filter.js'

export default defineConfig([
  globalIgnores(['dist', 'coverage', 'test-results', 'playwright-report', 'functions', 'scratch']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      'no-restricted-globals': ['error',
        { name: 'confirm', message: 'window.confirm 금지 → useConfirm() 훅을 사용하세요.' },
        { name: 'alert', message: 'window.alert 금지 → useToast() 훅을 사용하세요.' },
        { name: 'prompt', message: 'window.prompt 금지 → useConfirm() 또는 커스텀 입력 UI를 사용하세요.' },
      ],
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'jsx-a11y/label-has-associated-control': 'off',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-unused-vars': 'off',
      'no-restricted-globals': ['error',
        { name: 'confirm', message: 'window.confirm 금지 → useConfirm() 훅을 사용하세요.' },
        { name: 'alert', message: 'window.alert 금지 → useToast() 훅을 사용하세요.' },
        { name: 'prompt', message: 'window.prompt 금지 → useConfirm() 또는 커스텀 입력 UI를 사용하세요.' },
      ],
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'jsx-a11y/label-has-associated-control': 'off',
    },
  },
  {
    files: ['scripts/**/*.js', '*.config.js', '*.config.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/*.test.{js,jsx,ts,tsx}', '**/__tests__/**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      globals: {
        vi: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
  },
  {
    // 멀티테넌트 격리: tenant-scoped Firestore 도메인 파일의 query()에 organizationId 필터 강제.
    // 전역 도메인(organizations, users, favorites, feedbacks, notifications, superAdmin,
    // statistics, holidays, preRegistered, cache)은 조직 격리 대상이 아니므로 제외한다.
    files: [
      'src/lib/firestore/reservations.ts',
      'src/lib/firestore/vehicles.ts',
      'src/lib/firestore/fuelLogs.ts',
      'src/lib/firestore/maintenance.ts',
      'src/lib/firestore/hipass.ts',
      'src/lib/firestore/hipassCharges.ts',
      'src/lib/firestore/dailyLogQueries.ts',
      'src/lib/firestore/driveLogs/**/*.ts',
    ],
    plugins: {
      local: { rules: { 'require-organization-filter': requireOrganizationFilter } },
    },
    rules: {
      'local/require-organization-filter': 'error',
    },
  },
])
