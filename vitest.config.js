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
            // git 워크트리는 다른 브랜치의 중첩 체크아웃 — 부모 런이 스캔하면 안 된다
            // (.worktrees/*는 수동 워크트리, .claude/worktrees/*는 Claude Code 에이전트 워크트리)
            '**/.worktrees/**',
            '**/.claude/worktrees/**',
            // 에뮬레이터 없이 도는 일반 유닛 런/lint-staged에서는 rules 테스트를 제외한다.
            // (해당 에뮬레이터 실행 시에만 호스트 env가 세팅되어 포함됨)
            ...(!process.env.FIRESTORE_EMULATOR_HOST ? ['tests/firestore-rules.test.ts'] : []),
            ...(!process.env.FIREBASE_STORAGE_EMULATOR_HOST ? ['tests/storage-rules.test.ts'] : [])
        ],
        coverage: {
            provider: 'v8',
            // json-summary는 CI 아티팩트(coverage-summary.json) 업로드용
            reporter: ['text', 'text-summary', 'json', 'json-summary', 'lcov', 'html'],
            // 실측(2026-08-09: lines 44.83/stmts 43.97/funcs 36.95/branches 35.35) 기준
            // 후퇴 방지선(안전 마진 ~1pp). 목표는 숫자가 아니라 회귀 차단 — 테스트 추가에 맞춰 단계 상향.
            // 2026-07-10 임계경로 테스트(syncQueue·auth·예약 제출) 추가로 하한 상향.
            // 2026-07-25 출력물·경로 계산 테스트(lib/pdf 5%→97%, lib/tmap 16%→97%) 추가로 재상향.
            // 2026-08-09 UI 계층 테스트(예약 사이드 패널·차량 관리·운행일지 폼 훅) + 통계 계산
            //            (analyticsCalc 비용/추천, monthlyReportCalc, reservationPatternCalc) 추가로 재상향.
            // 2026-08-09 지도(OrgMapView)·차트(TrendCharts·ReportCharts) 추가로 재상향
            //            (실측 lines 45.76/stmts 44.76/funcs 37.35/branches 35.84).
            // 2026-08-22 커버리지 0%였던 훅 2종(useDriveLogList·useDailyLog)과 온디맨드 동기화
            //            (useCalendarSync)·건의 모달 접근성 테스트 추가로 재상향
            //            (실측 lines 49.56/stmts 48.46/funcs 40.57/branches 38.18).
            //
            // ── 전역 임계치만으로는 부족하다 ──
            // 전역 평균만 보면 **커버리지 0%인 핵심 모듈이 있어도 통과한다.** 잘 덮인 순수 함수
            // 모듈(lib/pdf·lib/tmap 97%)이 평균을 끌어올려 주기 때문이다. 그래서 사용자가 매일
            // 지나가는 경로에는 아래 glob 하한을 따로 건다 — 그 경로의 테스트를 지우거나
            // 테스트 없는 코드를 크게 덧붙이면 전역 평균과 무관하게 실패한다.
            //
            // glob 하한은 실측보다 3~6pp 낮게 잡는다. 리팩토링으로 분기 몇 개가 오가는 정도로는
            // 깨지지 않되, 모듈 하나가 통째로 무방비가 되면 걸리는 선이다.
            thresholds: {
                lines: 48,
                statements: 47,
                functions: 39,
                branches: 37,

                // 운행일지 폼 — 서비스의 본체. 여기가 틀리면 기록 자체가 틀어진다 (실측 88/86/84/75)
                'src/hooks/driveLogForm/**': {
                    lines: 84, statements: 82, functions: 80, branches: 70,
                },
                // 통계·집계 계산 — 관리자가 결재에 올리는 숫자 (실측 97/94/97/81)
                'src/hooks/utils/**': {
                    lines: 92, statements: 90, functions: 92, branches: 76,
                },
                // 예약 캘린더 데이터 흐름 (실측 64/61/65/58)
                'src/hooks/reservationCalendar/**': {
                    lines: 60, statements: 57, functions: 60, branches: 54,
                },
                // 오프라인 큐 — 지하주차장에서 쓴 기록이 사라지지 않게 하는 유일한 장치 (실측 92/81/82/73)
                'src/lib/offline/**': {
                    lines: 87, statements: 77, functions: 77, branches: 68,
                },
                // Firestore 도메인 — organizationId 격리가 사는 자리 (실측 54/53/50/60)
                'src/lib/firestore/**': {
                    lines: 50, statements: 49, functions: 45, branches: 55,
                },
                // 문서 스키마 — 필드 누락이 조용한 데이터 유실로 이어지는 경계 (실측 100/100/100/67)
                'src/schemas/**': {
                    lines: 95, statements: 95, functions: 95, branches: 60,
                },
                // 운행일지 목록 — 관리자가 기록을 확인하고 지우는 화면. 필터를 빠르게 바꿀 때
                // 이전 요청의 늦은 응답이 최신 목록을 덮는 경합(requestIdRef)이 여기 있고,
                // 그 회귀는 테스트 없이는 알아챌 방법이 사실상 없다 (실측 90/87/94/72)
                'src/hooks/useDriveLogList.ts': {
                    lines: 85, statements: 82, functions: 88, branches: 66,
                },
                // 일별일지 — 누계 주행거리를 만드는 계산. 금일 거리는 음수 구간을 버리고,
                // 금일 누계는 합이 아니라 최댓값이다. 이 숫자가 대외 보고 자료가 된다
                // (실측 100/98/100/81)
                'src/hooks/useDailyLog.ts': {
                    lines: 94, statements: 92, functions: 94, branches: 74,
                },
                // 기관 문서 — 초대 코드·승인 상태·소속 사용자 일괄 삭제가 지나가는 자리. 글롭 평균(57%)이
                // 통과하는 동안 이 파일은 26%였다 — 위 "전역 임계치만으로는 부족하다"가 한 단계 아래에서
                // 재현된 것이라 파일 단위로 따로 건다 (2026-09-02 실측 96/96/100/100)
                'src/lib/firestore/organizations.ts': {
                    lines: 90, statements: 90, functions: 95, branches: 90,
                },
                // 온디맨드 캘린더 동기화 — 예약 화면을 열 때마다 백그라운드로 호출되므로
                // "실패했을 때 몇 번 더 부르는가"가 곧 비용이다. 서버 빈도 상한 응답에
                // 재시도하지 않는 계약을 고정한다 (실측 66/65/50/60)
                'src/hooks/useCalendarSync.ts': {
                    lines: 60, statements: 59, functions: 45, branches: 54,
                },
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
