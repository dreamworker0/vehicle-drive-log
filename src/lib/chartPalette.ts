/**
 * chartPalette — 차트(Recharts) 공용 색상
 *
 * 차트 파일 20여 곳이 같은 hex를 각자 적고 있었다(축·격자·툴팁 회색이 50여 번).
 * 색을 바꾸거나 다크 모드를 손볼 때 한 곳만 고치면 되도록 여기 모은다(2026-11-25 외부 리뷰 P3-15).
 *
 * **역할(격자·축)이 아니라 명도 단계와 색상 이름으로 둔다.** 같은 회색이 격자에도, 툴팁 테두리에도,
 * 데이터 조각("미연결")에도 쓰여 역할 이름으로 묶으면 의미가 틀어진다. 값은 Tailwind 기본 팔레트와 같다.
 *
 * 디자인 토큰(primary-*·surface-*)으로 옮기는 것은 별도 단계다 — 지금은 값을 바꾸지 않고 모으기만 한다.
 * 라이트·다크 팔레트를 따로 설계한 차트(DriveOriginChart)와 브랜드 색(Google·Slack 로고)은 대상이 아니다.
 */

/** 회색(Tailwind gray) — 축 글자·격자·툴팁 */
export const CHART_NEUTRAL = {
    200: '#e5e7eb',
    300: '#d1d5db',
    400: '#9ca3af',
    500: '#6b7280',
    600: '#4b5563',
    700: '#374151',
    800: '#1f2937',
} as const;

/** 회청색(Tailwind slate) — 밝은 배경 차트의 축·격자 */
export const CHART_SLATE = {
    100: '#f1f5f9',
    200: '#e2e8f0',
    400: '#94a3b8',
    500: '#64748b',
    700: '#334155',
    800: '#1e293b',
} as const;

/** 데이터 계열 색 */
export const CHART_SERIES = {
    blue: '#3b82f6',
    blueDark: '#2563eb',
    violet: '#8b5cf6',
    violetDark: '#6d28d9',
    purple: '#a855f7',
    fuchsia: '#d946ef',
    indigo: '#6366f1',
    indigoLight: '#818cf8',
    cyan: '#06b6d4',
    teal: '#14b8a6',
    emerald: '#10b981',
    emeraldLight: '#34d399',
    emeraldDark: '#059669',
    green: '#22c55e',
    greenLight: '#4ade80',
    lime: '#84cc16',
    amber: '#f59e0b',
    amberLight: '#fbbf24',
    yellow: '#eab308',
    orange: '#f97316',
    red: '#ef4444',
    redLight: '#f87171',
    redDark: '#dc2626',
    pink: '#ec4899',
    pinkLight: '#f472b6',
    white: '#ffffff',
} as const;
