import { isFirestoreTerminated } from './firestoreLifecycle';
import { scrubContext, scrubConsoleArgs, joinConsoleArgs, scrubUrl, scrubDomTarget, scrubSpanData, scrubSpanName } from './sentryScrub';

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;

/**
 * 릴리즈(배포 커밋 SHA) — 배포 워크플로가 빌드 시 `VITE_SENTRY_RELEASE`로 넣는다.
 *
 * 이 값이 없으면 Sentry에 릴리즈 개념이 없어 **"Resolved in next release"가 동작하지 않고**
 * (릴리즈 미등록 프로젝트에서는 `Unable to update issues`로 실패한다), 에러가 어느 배포에서
 * 생겼는지도 알 수 없다. 로컬 개발 빌드에서는 비어 있는 게 정상이다.
 */
const SENTRY_RELEASE = import.meta.env.VITE_SENTRY_RELEASE;

// @sentry/react(~139KB)를 정적 import하지 않고 initSentry 시점에 동적 로드한다.
// lightEntry(비로그인) 경로는 initSentry를 호출하지 않으므로 SDK 다운로드 자체가 생략되고,
// appEntry의 지연 초기화(import('./lib/sentry').then(m => m.initSentry()))가 실제로 지연 효과를 갖는다.
// 패키지를 직접 동적 import하지 않고 sentryClient(선별 재수출)를 경유해 트리셰이킹을 유지한다.
type SentryModule = typeof import('./sentryClient');

type SentryUserInfo = { uid: string; email?: string; role?: string; organizationId?: string } | null;

let sentry: SentryModule | null = null;
let sentryLoading: Promise<SentryModule | null> | null = null;
// SDK 로드 완료 전에 setSentryUser가 호출되면 보관했다가 init 직후 적용 (undefined = 대기 없음)
let queuedUser: SentryUserInfo | undefined;

export function initSentry() {
    if (!SENTRY_DSN || sentryLoading) return;

    sentryLoading = import('./sentryClient')
        .then((Sentry) => {
            initSentryWithModule(Sentry);
            sentry = Sentry;
            if (queuedUser !== undefined) {
                applySentryUser(Sentry, queuedUser);
                queuedUser = undefined;
            }
            return Sentry;
        })
        .catch(() => null); // SDK 로드 실패(네트워크 등) 시 무시 — captureError는 console 출력만 유지

    return;
}

function initSentryWithModule(Sentry: SentryModule) {
    Sentry.init({
        dsn: SENTRY_DSN,
        environment: import.meta.env.MODE,
        // 이 앱이 보낸 이벤트임을 표시한다 — 같은 Sentry 프로젝트를 다른 앱과 공유하고 있어
        // 태그가 없으면 남의 앱 에러를 우리 것으로 오인한 채 트리아지하게 된다
        // (성과관리 앱의 ApiError가 우리 이슈로 올라온 사례). 이슈 검색에서 `app:vehicle-drive-log`로 거른다.
        // 로그인 여부와 무관한 값이라 로그아웃 때 정리되는 user.role·organizationId와 달리
        // 스코프에 처음부터 심어 둔다 — 비로그인 화면에서 난 에러에도 붙어야 한다.
        initialScope: { tags: { app: 'vehicle-drive-log' } },
        // 값이 없을 때 release: undefined를 넘기지 않도록 조건부로 편다 (SDK 기본 동작 유지)
        ...(SENTRY_RELEASE ? { release: SENTRY_RELEASE } : {}),
        // 프로덕션 30% 샘플링 (주간 ~5k 샘플 확보, 비용·오버헤드 절감), 개발 시 0%
        tracesSampleRate: import.meta.env.PROD ? 0.3 : 0,
        // 자체 도메인만 트레이스 전파 (외부 API로의 불필요한 헤더 전송 차단)
        tracePropagationTargets: ['localhost', /^https:\/\/vehicle-drive-log\.web\.app/],
        // 브라우저 성능 및 라우팅 트레이싱 활성화
        integrations: [
            Sentry.browserTracingIntegration(),
        ],
        // console 호출은 SDK 기본 breadcrumbsIntegration이 **인자를 그대로** 담아 다음
        // 이벤트에 붙인다. 즉 captureError/captureWarning에서 extra를 걸러도, 같은 함수의
        // console 출력이 원본을 다시 실어 보낸다. 앱 전역 console이 대상이라 여기서 막는다.
        //
        // SDK는 인자로 `data.arguments`와 `message`(= safeJoin(args, ' '))를 **둘 다** 만들고
        // (integrations/breadcrumbs.js), Sentry 화면이 보여 주는 것은 message다. 인자만 걸러
        // 두면 개인정보는 message로 나가고 진단만 사라지는 정확히 반대인 결과가 되므로,
        // 걸러낸 인자로 message를 다시 만든다. console.assert는 접두어를 보존한다.
        beforeBreadcrumb(breadcrumb) {
            const args = (breadcrumb.data as { arguments?: unknown[] } | undefined)?.arguments;
            if (breadcrumb.category === 'console' && Array.isArray(args)) {
                const safeArgs = scrubConsoleArgs(args);
                breadcrumb.data = { ...breadcrumb.data, arguments: safeArgs };
                const assertPrefix = typeof breadcrumb.message === 'string'
                    && breadcrumb.message.startsWith('Assertion failed: ')
                    ? 'Assertion failed: ' : '';
                breadcrumb.message = assertPrefix + joinConsoleArgs(safeArgs);
            }

            // 요청 URL — 이 앱은 목적지 검색을 쿼리로 보낸다(/api/tmap?...&keyword=김OO 어르신 댁).
            // fetch·xhr breadcrumb은 URL을 통째로 담으므로, 오류 하나에 직전 검색어가 딸려 나갔다.
            if (breadcrumb.category === 'fetch' || breadcrumb.category === 'xhr') {
                const data = breadcrumb.data as { url?: unknown } | undefined;
                if (typeof data?.url === 'string') {
                    breadcrumb.data = { ...data, url: scrubUrl(data.url) };
                }
            }

            // 화면 이동 — 경로에 쿼리가 붙어 오는 경우를 같은 규칙으로 막는다.
            if (breadcrumb.category === 'navigation') {
                const data = breadcrumb.data as { from?: unknown; to?: unknown } | undefined;
                if (data) {
                    breadcrumb.data = {
                        ...data,
                        ...(typeof data.from === 'string' ? { from: scrubUrl(data.from) } : {}),
                        ...(typeof data.to === 'string' ? { to: scrubUrl(data.to) } : {}),
                    };
                }
            }

            // 클릭·입력 — SDK가 aria-label·title·alt를 **설정과 무관하게 항상** 붙인다.
            // 이 앱은 거기에 실명을 넣는다(title="공동 운전자: 홍길동, 김철수").
            // 접근성에 필요한 값이라 화면에서 뺄 수 없으니 나가는 길목에서 지운다.
            if (typeof breadcrumb.category === 'string' && breadcrumb.category.startsWith('ui.')
                && typeof breadcrumb.message === 'string') {
                breadcrumb.message = scrubDomTarget(breadcrumb.message);
            }

            return breadcrumb;
        },
        /**
         * 스팬 속성 — breadcrumb만 막아서는 **같은 검색어가 한 번 더 나간다.**
         *
         * browserTracing이 켜져 있어(위 integrations) 요청마다 스팬이 만들어지는데,
         * `getFetchSpanAttributes`가 `url`에 원본 URL을 통째로, `http.query`에 쿼리를
         * 그대로 담는다. 위생 처리를 거치는 것은 스팬 **이름**(`GET /api/tmap`)뿐이다.
         * 트랜잭션 이벤트라 beforeSend도 타지 않는다(그쪽은 오류 이벤트 전용).
         *
         * 이 훅은 루트 스팬과 자식 스팬 **모두**에 적용된다(core/client.js processBeforeSend).
         * standalone 스팬도 여기를 거친다 — 트랜잭션이 아니라 스팬 봉투로 따로 나가지만
         * `createSpanEnvelope`가 같은 콜백을 태운다(core/envelope.js).
         *
         * **이름도 함께 걸러야 한다.** 지금 설정에서 standalone인 것은 INP인데, 그 스팬은
         * 이름 자체가 요소 설명이라(`metrics/inp.js`) `aria-label`·`title`이 그대로 실린다.
         * (CLS·LCP는 standalone이 아니라 pageload 루트 스팬의 속성으로 나간다 — 그쪽은
         * `scrubSpanData`가 맡는다.) Phase 211에서 이 경로를 "설치본에 없는 패키지"라며
         * 반려했는데, 패키지 이름만 달랐을 뿐(`@sentry/browser-utils`) 경로는 실재했다.
         */
        beforeSendSpan(span) {
            const data = scrubSpanData(span.data as Record<string, unknown> | undefined);
            const description = scrubSpanName(span.description);
            if (data === span.data && description === span.description) return span;
            return { ...span, data, description } as typeof span;
        },
        // 노이즈 에러 필터링
        ignoreErrors: [
            // reCAPTCHA 중복 렌더링 에러 (인앱 브라우저 및 특정 WebView 환경에서 발생하는 외부 노이즈)
            'reCAPTCHA has already been rendered in this element',
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
            // 인앱 브라우저(WebView)에서 불안정한 네트워크로 HTML 응답이 다운로드 중 잘려
            // 인라인 스크립트 파싱이 EOF에 도달할 때 발생 (문서 URL /login:1 로 보고됨, 앱 버그 아님).
            // 진짜 JSON.parse 버그는 "Unexpected end of JSON input"로 뜨므로 매칭되지 않음.
            /Unexpected end of input/,
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
            // iOS Safari IndexedDB 레코드 삭제 에러 (기기 저장 공간 부족 또는 시스템 락, 앱 버그 아님)
            /Failed to delete record from object store/,
            // iOS Safari(WebKit) IndexedDB 트랜잭션 조기 커밋 에러.
            // Firebase 영속성 레이어가 WebKit의 트랜잭션 auto-commit과 경합할 때 발생하는
            // unhandledrejection 노이즈다(스택 프레임이 없어 firebase-* 번들 필터를 우회한다).
            // iOS는 Background Sync 미지원('SyncManager' 부재)이라 SW의 flushQueue 경로는 실행되지 않는다
            // (페이지 컨텍스트의 registerReconnectFlush 폴백이 대신 처리) — 앱 버그 아님.
            //
            // **동작(verb)만 다른 변종이 계속 올라온다** — 처음엔 `delete range`만 막았는데
            // `UnknownError: Attempt to get a record from database ...`(iOS 18.7 Mobile Safari,
            // /employee/fuel)가 또 왔다. WebKit은 put/getAll 등 다른 변종도 같은 문구로 던지므로
            // 동작 이름을 빼고 이 버그 고유의 문구로 잡는다. 앱·다른 SDK 메시지와 겹치지 않는다.
            // (앱 쪽 억제는 firebase.ts의 unhandledrejection 핸들러가 이미 한다 — 여기는 Sentry
            //  전용이다. Sentry 글로벌 핸들러가 먼저 잡아 preventDefault로는 리포트가 안 막힌다.)
            /without an in-progress transaction/,
            // 로그아웃 시 Firestore를 의도적으로 terminate()한 뒤 하드 리로드하는데(logout→clearOfflineCache),
            // 그 순간 아직 진행 중이던 리스너/쿼리가 "Firestore shutting down"으로 reject되며 나는
            // teardown 레이스다. handled=yes이고 리로드 후 새 인스턴스로 정상 동작 — 앱 버그 아님.
            /Firestore shutting down/i,
            // 위 teardown 레이스의 Chromium(Edge/Chrome) 판이다.
            // `UnknownError: Connection is closing.`은 Blink IndexedDB가 **닫히는 중인 커넥션**에
            // 요청이 들어올 때 던지는 DOMException으로, 페이지 이탈·탭 종료나 우리가 의도적으로
            // 커넥션을 닫는 경로(logout→clearOfflineCache의 terminate+clearIndexedDbPersistence,
            // attemptCacheRecovery)에서 Firestore 영속성 레이어의 잔여 IDB 요청이 뒤늦게 도착하며 난다.
            // 스택 프레임이 없는 unhandledrejection이라 firebase-* 번들 필터를 우회한다
            // (앱 쪽 억제는 firebase.ts의 isFirestorePersistenceError가 'UnknownError'로 이미 한다 —
            //  여기는 Sentry 전용이다. Sentry 글로벌 핸들러가 먼저 잡아 preventDefault로는 안 막힌다).
            // DOMException으로 직접 보고되면 값이 "Connection is closing."뿐이라 `UnknownError:`
            // 접두사에 의존하지 않고 이 문구로 잡는다 — 앱 버그 아님.
            /Connection is closing/,
            // Firestore IndexedDB 내부 캐시 손상 (Firebase SDK 버그, 앱 버그 아님)
            /INTERNAL ASSERTION FAILED/,
            /Unexpected state/,
            // iOS Safari(WebKit) IndexedDB 내부 오류 — 스택 없는 "Internal error" unhandledrejection으로
            // 보고되며(iOS 18.x /employee/drive-log 등), Firestore 영속성 레이어가 WebKit IDB의
            // 내부 실패를 그대로 전파하는 환경 노이즈다(앱 버그 아님). 앵커로 정확 일치만 차단해
            // "Internal error opening backing store" 등 다른 메시지와 겹치지 않게 좁힌다.
            /^Internal error\.?$/,
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
            // CSP 위반 에러 (Firebase Auth signInWithRedirect, reCAPTCHA v3 App Check 등
            // Google/Firebase SDK 내부에서 동적 스크립트 삽입·eval() 사용으로 발생하는 환경 노이즈, 앱 버그 아님)
            /Refused to .* because it violates the .* Content Security Policy directive/,
            /blocked by Content Security Policy/i,
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

            // 인앱 브라우저(WebView)에서 HTML 문서가 네트워크로 스트리밍되다 잘려
            // 인라인 스크립트 파싱이 EOF/구문 오류로 실패하는 환경 노이즈 확정 차단.
            // ignoreErrors(/Unexpected end of input/)가 놓치는 변형 메시지까지 포괄한다:
            // 번들 스크립트(.js/.mjs)가 아니라 문서 URL(/login 등)에서 난 SyntaxError는
            // 우리 코드 버그가 아니라 문서 전송 절단이므로 억제한다(트랜잭션 /login 등으로 보고됨).
            // 진짜 코드 버그의 SyntaxError는 번들 청크(.js) 프레임을 가지므로 통과한다.
            const firstException = event.exception?.values?.[0];
            if (firstException?.type === 'SyntaxError') {
                const topFrame = frames?.[frames.length - 1];
                if (!/\.m?js(\?|$)/.test(topFrame?.filename || '')) {
                    return null;
                }
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

            // 로그아웃 teardown 레이스: 우리가 의도적으로 terminate한 Firestore 인스턴스에
            // 뒤늦게 도착한 호출이 내는 동기 throw다(JAVASCRIPT-REACT-60).
            // **isFirestoreTerminated()가 true일 때만** 억제한다 — 종료를 지시한 적이 없는데
            // 이 에러가 났다면 그건 진짜 앱 버그이므로 그대로 보고돼야 한다.
            // (앱 쪽 재구독 차단은 useAuth의 canWatch/scheduleWatchRetry가 이미 한다 —
            //  여기는 남은 경로가 uncaught로 새는 것만 막는 안전망이다. setTimeout 래퍼가
            //  잡아 rethrow하는 형태라 ignoreErrors·preventDefault로는 걸러지지 않는다.)
            if (isFirestoreTerminated() && /client has already been terminated/.test(errorMsg)) {
                return null;
            }

            // CSP 위반 이벤트 보완 필터링 (ignoreErrors를 우회해 전파되는 케이스 차단)
            // SecurityPolicyViolationEvent 타입이거나 CSP 디렉티브 키워드가 메시지에 포함된 경우
            const exceptionType = event.exception?.values?.[0]?.type || '';
            if (
                exceptionType === 'SecurityPolicyViolationEvent' ||
                /(?:script-src|connect-src|style-src|font-src|img-src|frame-src|default-src)(?:-elem|-attr)?\b/.test(errorMsg)
            ) {
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
        reportWebVitals(Sentry);
    }
}

function applySentryUser(Sentry: SentryModule, userInfo: SentryUserInfo) {
    if (userInfo) {
        // **이메일은 보내지 않는다.** uid만으로 사용자 수·이슈 묶음·검색이 모두 동작하고,
        // 누구인지는 필요할 때 Firebase 콘솔에서 조회하면 된다. 이메일은 이슈 목록에서
        // 읽기 편한 것 말고 얻는 것이 없는데, 같은 모듈의 스크러버(sentryScrub)가
        // extra·console·breadcrumb에서 가장 공들여 지우는 값이 바로 이메일 모양이다.
        // 그것을 매 이벤트에 붙여 보내면 앞뒤가 맞지 않는다.
        Sentry.setUser({ id: userInfo.uid });
        Sentry.setTag('user.role', userInfo.role || 'unknown');
        if (userInfo.organizationId) {
            Sentry.setTag('organizationId', userInfo.organizationId);
        }
    } else {
        Sentry.setUser(null);
        // 로그아웃 시 이전 세션의 역할·기관 태그가 스코프에 잔존해 후속(teardown) 이벤트에
        // 잘못 붙는 것을 방지 — 함께 정리한다.
        Sentry.setTag('user.role', undefined);
        Sentry.setTag('organizationId', undefined);
    }
}

/**
 * 인증된 사용자 정보를 Sentry 컨텍스트에 설정한다.
 * 에러 발생 시 어떤 사용자/역할/기관에서 발생했는지 추적할 수 있다.
 * SDK 로드 전 호출은 보관했다가 init 직후 적용된다.
 */
export function setSentryUser(userInfo: SentryUserInfo) {
    if (!SENTRY_DSN) return;
    if (sentry) {
        applySentryUser(sentry, userInfo);
    } else {
        queuedUser = userInfo;
    }
}

export function captureError(error: unknown, context: Record<string, unknown> = {}) {
    // initSentry가 호출된 적 없으면(비로그인 경량 경로) 기존과 동일하게 콘솔 출력만 수행
    if (SENTRY_DSN && sentryLoading) {
        // 도메인 함수들이 저장하려던 문서를 통째로 넘기므로(`{ context, data }`) 목적지·
        // 동승자 이름·비고 같은 자유 입력이 그대로 실린다. 보내기 직전 여기서 거른다.
        // 아래 console 출력은 원본 그대로 둔다(개발자 도구에서의 진단이 우선) — 그것이
        // breadcrumb으로 새는 경로는 init의 beforeBreadcrumb이 따로 막는다.
        const safeContext = scrubContext(context);
        sentryLoading.then((Sentry) => Sentry?.captureException(error, { extra: safeContext }));
    }
    console.error(error);
}

/**
 * 경고 수준 기록 — **원인이 설명되는 사건**에 쓴다.
 *
 * error 수준은 Sentry의 고우선 알림 규칙에 걸려 운영자에게 메일이 간다. 계정 비활성화로
 * 세션이 끊긴 것처럼 서버가 의도한 결과까지 error로 올리면 알림은 울리는데 할 일은 없는
 * 사건이 쌓여 진짜 결함이 묻힌다(2026-09-02 `[Auth] 예기치 않은 세션 종료` 사례).
 * 발생 사실은 남겨야 하므로(빈도가 곧 근거다) 수준만 낮춘다.
 */
export function captureWarning(message: string, context: Record<string, unknown> = {}) {
    if (SENTRY_DSN && sentryLoading) {
        const safeContext = scrubContext(context);
        sentryLoading.then((Sentry) => Sentry?.captureMessage(message, { level: 'warning', extra: safeContext }));
    }
    console.warn(message, context);
}

/**
 * Web Vitals(LCP, FID, CLS, FCP, TTFB) 수집 → Sentry Custom Measurements
 */
function reportWebVitals(Sentry: SentryModule) {
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
