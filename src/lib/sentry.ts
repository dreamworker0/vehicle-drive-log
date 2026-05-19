import * as Sentry from '@sentry/react';

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;

export function initSentry() {
    if (!SENTRY_DSN) return;

    Sentry.init({
        dsn: SENTRY_DSN,
        environment: import.meta.env.MODE,
        // 프로덕션 30% 샘플링 (주간 ~5k 샘플 확보, 비용·오버헤드 절감), 개발 시 0%
        tracesSampleRate: import.meta.env.PROD ? 0.3 : 0,
        // 자체 도메인만 트레이스 전파 (외부 API로의 불필요한 헤더 전송 차단)
        tracePropagationTargets: ['localhost', /^https:\/\/vehicle-drive-log\.web\.app/],
        // 브라우저 성능 및 라우팅 트레이싱 활성화
        integrations: [
            Sentry.browserTracingIntegration(),
        ],
        // 노이즈 에러 필터링
        ignoreErrors: [
            'ResizeObserver loop',
            'Non-Error promise rejection',
            'Network request failed',
            /is not a function or its return value is not iterable/,
            'Failed to get document because the client is offline',
            /FirebaseError.*unavailable/,
            /FirebaseError.*internal/,
            // 모바일 네트워크 불안정 시 Firestore 연결 실패 (환경 이슈, 앱 버그 아님)
            /FirebaseError.*Connection failed/,
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
            // SW registration이 null/unregistered 상태에서 .update() 호출 시 발생 (환경 이슈, 앱 버그 아님)
            /Cannot update a null/,
            /nonexistent service worker/,
            // vite-plugin-pwa registerSW 내부에서 iOS Safari SW lifecycle 타이밍 이슈로 발생 (앱 버그 아님)
            /newestWorker is null/,
            // Facebook 인앱 브라우저 네이티브 브릿지 에러 (WebView 내부 이슈, 앱 버그 아님)
            /webkit\.messageHandlers/,
            // 특정 하이브리드 앱 또는 인앱 브라우저에서 스크립트 주입 시 발생하는 노이즈 에러 (앱 버그 아님)
            /mobileapp_.*/,
            // Facebook 인앱 브라우저 DOMException (WebView 호환성 이슈, 앱 버그 아님)
            /The object does not support the operation or argument/,
            // iOS Safari IndexedDB 삭제 에러 (사용자 데이터 삭제 또는 iOS 저장공간 자동 정리, 앱 버그 아님)
            /Database deleted by request of the user/,
            // Firestore IndexedDB 내부 캐시 손상 (Firebase SDK 버그, 앱 버그 아님)
            /INTERNAL ASSERTION FAILED/,
            /Unexpected state/,
            // IndexedDB 용량 초과 (사용자 기기 저장공간 부족, 앱 버그 아님)
            /QuotaExceededError/,
            /Encountered full disk/,
            /exceeded the quota/i,
            // 브라우저 비밀번호 관리자/확장이 크로스오리진 프레임 접근 시 발생 (앱 버그 아님)
            /Blocked a frame with origin/,
            // App Check reCAPTCHA Enterprise 타임아웃 (구형 브라우저·느린 네트워크 환경 이슈, 앱 버그 아님)
            /reCAPTCHA.*(Timeout|timeout)/,
            // Whale 브라우저 비밀번호 관리자가 DOM 스캔 중 SecurityError 발생 (브라우저 내부 동작, 앱 버그 아님)
            /hasPasswordField_/,
            // Firebase App Check 에러 (인프라 일시적 장애 및 모바일 네트워크 오프라인 노이즈)
            /AppCheck:.*(throttled|initial-throttle|500 error|fetch-network-error|failed to connect)/i,
            /App Check 토큰 발급 에러/i,
            /reCAPTCHA token is invalid/,
            // React Hydration 에러 제외 (사용자 환경의 번역기 플러그인 등으로 발생)
            /Hydration failed because the initial UI does not match what was rendered on the server/,
            /Text content does not match server-rendered HTML/,
            // Firestore 권한 부족 에러 (앱 내에서 catch 되어 정상 처리되는 케이스 억제)
            /Missing or insufficient permissions/,
            // 브라우저 확장 프로그램(번역기 등)의 중복 Custom Element 선언 에러 억제
            /has already been defined/,
            // 브라우저 비밀번호 관리자·자동완성 확장이 Custom Element를 이중 등록하는 에러 (앱 버그 아님)
            /autocomplete-textarea/,
            // 의도된 비즈니스 로직 에러 (글로벌 바운더리로 전파되는 노이즈 방지)
            /동일한 운행 기록이 이미 존재합니다/,
            /동기화 오류: 다른 사용자가 더 높은 누적 km/,
            /직전 운행 기록과 출발 주행거리가 일치하지 않습니다/,
            /REQUIRES_START_KM_CONFIRMATION/,
            // 구버전 클라이언트 캐시가 보내는 undefined 필드값 Firestore 저장 시도 에러 억제
            /Unsupported field value: undefined/,
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

            // Firebase SDK 번들 내부 에러 필터링 (Vite 빌드: firebase-{hash}.js)
            const frames = event.exception?.values?.[0]?.stacktrace?.frames;
            if (frames?.some(f =>
                f.filename?.includes('/firebase-') 
                // [임시 주석 처리] App Check 에러 추적을 위해 recaptcha 스택트레이스 포함 시 허용
                // || f.filename?.includes('recaptcha')
            )) {
                return null;
            }

            // 모든 브라우저의 DOM NotFoundError (DOMException code 8) 필터링
            // React virtual DOM과 브라우저 내부 동작(확장 프로그램, 자동완성, 콘텐츠 차단 등)의
            // 충돌로 발생하는 환경적 노이즈 (앱 버그 아님)
            // - Chrome/Samsung: "The node to be removed is not a child of this node"
            // - Safari/iOS:     "The object can not be found here"
            const errorMsg = event.exception?.values?.[0]?.value || '';
            if (/removeChild|The node to be removed is not a child|The object can not be found here/i.test(errorMsg)) {
                return null;
            }

            // 의도된 비즈니스 로직 에러 확정적 필터링 (ignoreErrors를 우회해 전파되는 케이스 차단)
            // ignoreErrors는 exception.values[0].value만 매칭하지만,
            // ErrorBoundary나 unhandledrejection 경로로 감싸진 에러는 원본 메시지가 달라질 수 있음
            const allMessages = (event.exception?.values || []).map(v => v.value || '').join(' ');
            if (/일치하지 않습니다|REQUIRES_START_KM_CONFIRMATION|동일한 운행 기록|동기화 오류.*누적 km|mobileapp_.*/.test(allMessages)) {
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
