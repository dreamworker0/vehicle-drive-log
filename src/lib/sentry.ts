import * as Sentry from '@sentry/react';

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;

export function initSentry() {
    if (!SENTRY_DSN) return;

    Sentry.init({
        dsn: SENTRY_DSN,
        environment: import.meta.env.MODE,
        // 프로덕션에서만 100% 샘플링, 개발 시 0%
        tracesSampleRate: import.meta.env.PROD ? 1.0 : 0,
        // 노이즈 에러 필터링
        ignoreErrors: [
            'ResizeObserver loop',
            'Non-Error promise rejection',
            'Network request failed',
            /is not a function or its return value is not iterable/,
            'Failed to get document because the client is offline',
            /FirebaseError.*unavailable/,
            /is not a valid JavaScript MIME type/,
            // 배포 후 구버전 청크 로드 에러
            'ChunkLoadError',
            /Loading chunk .* failed/,
            /Failed to fetch dynamically imported module/,
            /Importing a module script failed/,
            // 브라우저/PWA 관련 무해한 에러
            'AbortError',
            /Object Not Found Matching Id/,
            // iOS 인앱 브라우저 IndexedDB 연결 끊김 (환경 제한, 앱 버그 아님)
            /Connection to Indexed Database server lost/,
            // Facebook 인앱 브라우저 WebView 내부 에러 (앱 버그 아님)
            /Java object is gone/,
            // Facebook iOS 인앱 브라우저 IndexedDB 에러 (WebView 환경 제한)
            /Object store cannot be found/,
            // Firebase Auth 내부 assertion (iOS Safari ITP 환경에서 redirect 인증 시 발생, 앱 버그 아님)
            /Pending promise was never set/,
            // Service Worker 로드 실패 (배포 후 캐시 불일치, iOS 네트워크 제한 등 환경 이슈)
            /Script .* load failed/,
            // Service Worker 업데이트 경합 에러 (배포 후 SW 교체 시 환경 이슈, 앱 버그 아님)
            /Failed to update a ServiceWorker/,
            // Facebook 인앱 브라우저 네이티브 브릿지 에러 (WebView 내부 이슈, 앱 버그 아님)
            /webkit\.messageHandlers/,
            // Facebook 인앱 브라우저 DOMException (WebView 호환성 이슈, 앱 버그 아님)
            /The object does not support the operation or argument/,
            // iOS Safari IndexedDB 삭제 에러 (사용자 데이터 삭제 또는 iOS 저장공간 자동 정리, 앱 버그 아님)
            /Database deleted by request of the user/,
            // Firestore IndexedDB 내부 캐시 손상 (Firebase SDK 버그, 앱 버그 아님)
            /INTERNAL ASSERTION FAILED/,
            /Unexpected state/,
        ],
        // 브라우저 확장 프로그램 에러 제외
        denyUrls: [
            /extensions\//i,
            /^chrome:\/\//i,
            /^chrome-extension:\/\//i,
            /^moz-extension:\/\//i,
        ],
        beforeSend(event) {
            // 개발 환경에서는 전송하지 않음
            if (import.meta.env.DEV) return null;

            // Firebase SDK 번들 내부 에러 필터링
            const frames = event.exception?.values?.[0]?.stacktrace?.frames;
            if (frames?.some(f =>
                f.filename?.includes('firebase-auth') ||
                f.filename?.includes('firebase-db')
            )) {
                return null;
            }

            return event;
        },
    });

    // 프로덕션에서 Web Vitals 수집
    if (import.meta.env.PROD) {
        reportWebVitals();
    }
}

/**
 * 인증된 사용자 정보를 Sentry 컨텍스트에 설정한다.
 * 에러 발생 시 어떤 사용자/역할/기관에서 발생했는지 추적할 수 있다.
 * @param {{ uid: string, email?: string, role?: string, organizationId?: string }} userInfo
 */
export function setSentryUser(userInfo: { uid: string; email?: string; role?: string; organizationId?: string } | null) {
    if (!SENTRY_DSN) return;
    if (userInfo) {
        Sentry.setUser({
            id: userInfo.uid,
            email: userInfo.email || undefined,
        });
        Sentry.setTag('user.role', userInfo.role || 'unknown');
        if (userInfo.organizationId) {
            Sentry.setTag('organizationId', userInfo.organizationId);
        }
    } else {
        Sentry.setUser(null);
    }
}

export function captureError(error: unknown, context: Record<string, unknown> = {}) {
    if (SENTRY_DSN) {
        Sentry.captureException(error, { extra: context });
    }
    console.error(error);
}

/**
 * Web Vitals(LCP, FID, CLS, FCP, TTFB) 수집 → Sentry Custom Measurements
 */
function reportWebVitals() {
    import('web-vitals').then(({ onCLS, onFCP, onLCP, onTTFB, onINP }) => {
        const sendToSentry = (metric: { name: string; value: number }) => {
            Sentry.setMeasurement(metric.name, metric.value, metric.name === 'CLS' ? '' : 'millisecond');
        };
        onCLS(sendToSentry);
        onFCP(sendToSentry);
        onLCP(sendToSentry);
        onTTFB(sendToSentry);
        onINP(sendToSentry);
    }).catch(() => {
        // web-vitals 로드 실패 시 무시
    });
}
