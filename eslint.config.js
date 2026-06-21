import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import requireOrganizationFilter from './eslint-rules/require-organization-filter.js'

export default defineConfig([
  globalIgnores(['dist', 'coverage', 'test-results', 'playwright-report', 'functions/lib', 'functions/coverage', 'scratch']),
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
    // functions/는 Node/ESM 백엔드라 브라우저·React 규칙 대상에서 제외하고 아래 별도 블록에서 린트.
    ignores: ['functions/**'],
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
        jest: 'readonly', // functions 테스트는 Jest 기반
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
    // Cloud Functions (Node, ESM TypeScript). 루트가 functions 전체를 ignore하던 것을 해제하고
    // 프론트(브라우저/React) 규칙과 분리된 별도 규칙으로 린트한다. 컴파일 산출물(functions/lib)은
    // globalIgnores에서 제외된다.
    files: ['functions/**/*.ts'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^[A-Z_]', ignoreRestSiblings: true }],
      // Firestore 문서 등 동적 데이터가 많아 any는 경고로만 둔다(점진적 제거 대상, 빌드는 막지 않음).
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-unused-vars': 'off',
    },
  },
  {
    // functions 테스트·일회성 스크립트: Jest 모킹/CJS require 패턴이 정당하게 쓰이므로
    // 해당 규칙만 완화한다(소스 규칙은 위 블록에서 유지). node 런타임 글로벌도 부여.
    files: [
      'functions/**/__tests__/**/*.{ts,js}',
      'functions/**/*.test.{ts,js}',
      'functions/**/scripts/**/*.{ts,js}',
      'functions/scripts/**/*.{ts,js}',
    ],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      // 테스트 모킹·일회성 스크립트에서는 any를 허용한다(과도한 타입화 비용 회피).
      '@typescript-eslint/no-explicit-any': 'off',
      'no-undef': 'off',
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
