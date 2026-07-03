/**
 * sentryClient — @sentry/react에서 실제 사용하는 함수만 선별 재수출하는 동적 import 경계.
 *
 * sentry.ts가 `import('@sentry/react')`로 패키지 전체를 동적 로드하면 어떤 export가
 * 쓰일지 정적 분석이 불가능해 트리셰이킹이 무력화된다(139KB → 465KB, Replay/Feedback 포함).
 * 이 모듈을 경계로 두면 named re-export만 번들에 포함되어 SDK 크기가 유지된다.
 */
export {
    init,
    setUser,
    setTag,
    captureException,
    setMeasurement,
    browserTracingIntegration,
} from '@sentry/react';
