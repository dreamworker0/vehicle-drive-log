/**
 * LightApp — 비인증 사용자용 라우팅 (경량 엔트리의 화면 구성)
 *
 * `App.tsx`가 인증 사용자용 라우팅을 담듯, 이 파일은 비인증 경로만 담는다.
 * lightEntry.tsx는 마운트만 하고 화면 구성은 여기서 한다.
 *
 * ## 랜딩만 정적, 나머지는 지연 로딩
 * 예전에는 모든 라우트를 정적 import했고 AuthProvider까지 최상단에 있어서,
 * **랜딩만 보러 온 사람이** Firestore SDK(전송 164KB)와 약관·처리방침·FAQ 데이터까지
 * 전부 내려받았다. Lighthouse 모바일에서 LCP의 90%가 네트워크가 아니라 **렌더 대기**로
 * 잡힌 이유다(2026-08-09 측정).
 *
 * 그래서 LCP를 결정하는 랜딩만 정적으로 두고 나머지는 그 경로에 들어갈 때 받는다.
 * 라우트 이동 시 청크 왕복이 한 번 더 생기지만, 그건 이미 화면이 떠 있는 상태의 비용이다.
 * 청크 실패 시 재시도는 App.tsx와 같이 `lazyWithRetry`에 맡긴다(배포 직후 구버전 해시 대응).
 */
import { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { lazyWithRetry } from './lib/lazyWithRetry';
import InAppBrowserGuard from './components/common/InAppBrowserGuard';
import LightErrorBoundary from './components/common/LightErrorBoundary';

// 랜딩은 LCP를 결정하는 화면이라 정적으로 둔다 — 여기에 lazy를 걸면 청크 왕복이 하나 더 붙는다.
import LandingPage from './components/auth/LandingPage';

/*
 * ## 이 둘은 지연 로딩하지 않는다 — 화면이 아니라 **타이밍이 있는 부수효과**다
 *
 * 처음엔 "첫 페인트에 필요 없다"는 이유로 둘 다 lazy로 돌렸는데, 그건 이 컴포넌트들이
 * 무엇을 하는지 잘못 본 것이었다. 둘 다 화면에는 거의 아무것도 그리지 않는다.
 *   - UpdatePrompt: `registerSW()`를 부르는 자리 — **서비스 워커 등록이 여기서 일어난다.**
 *     오프라인 사용이 이 앱의 핵심 기능인데, 등록이 부가 청크에 실려 있으면 그 청크를
 *     못 받는 회선에서는 오프라인 캐시가 아예 만들어지지 않는다.
 *   - InstallPrompt: `beforeinstallprompt`를 잡는 자리. 이 이벤트는 **한 번만, 이르게**
 *     오므로 리스너가 늦게 붙으면 안드로이드 설치 배너가 영영 뜨지 않는다.
 * 무게 때문에 뺐던 것은 이들 자신이 아니라 `lib/firebase` 간선이었고, 그건 InstallPrompt
 * 안에서 이미 끊었다(동적 import). 정적으로 되돌려도 임계 경로 비용은 사실상 없다.
 */
import UpdatePrompt from './components/common/UpdatePrompt';
import InstallPrompt from './components/common/InstallPrompt';

const LoginPage = lazyWithRetry(() => import('./components/auth/LoginPage'));
// `/apply`만 AuthProvider(= Firestore)가 필요하다 — 그 래퍼째로 이 경로에서만 받는다.
const OrgApplicationRoute = lazyWithRetry(() => import('./components/auth/OrgApplicationRoute'));
const TermsPage = lazyWithRetry(() => import('./components/auth/TermsPage'));
const PrivacyPage = lazyWithRetry(() => import('./components/auth/PrivacyPage'));
const ReleaseNotesPage = lazyWithRetry(() => import('./components/auth/ReleaseNotesPage'));
const FAQPage = lazyWithRetry(() => import('./components/auth/FAQPage'));

/** 라우트 전환 중 잠깐 뜨는 자리표시자 */
function RouteFallback() {
    return (
        <div className="min-h-screen flex items-center justify-center" role="status" aria-label="페이지를 불러오는 중">
            <div className="w-8 h-8 spinner" />
        </div>
    );
}

export default function LightApp() {
    return (
        // 지연 로딩 라우트의 청크를 두 번 연속 못 받으면 예외가 여기까지 올라온다.
        // 경계가 없으면 공개 화면 전체가 빈 흰 화면이 된다(경량 엔트리에는 ErrorBoundary가
        // 없었다 — 라우트가 전부 정적이던 시절의 전제였다).
        <LightErrorBoundary>
            <Suspense fallback={<RouteFallback />}>
                <Routes>
                    <Route path="/" element={<LandingPage />} />
                    {/* 인앱 브라우저에서는 외부 브라우저 안내로 대체 (랜딩 등 다른 라우트는 그대로 노출) */}
                    <Route path="/login" element={<InAppBrowserGuard><LoginPage /></InAppBrowserGuard>} />
                    <Route path="/apply" element={<OrgApplicationRoute />} />
                    <Route path="/terms" element={<TermsPage />} />
                    <Route path="/privacy" element={<PrivacyPage />} />
                    <Route path="/release-notes" element={<ReleaseNotesPage />} />
                    <Route path="/faq" element={<FAQPage />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </Suspense>

            {/* 둘 다 화면을 그리지 않는다(null 반환) — 위 import 주석 참고 */}
            <UpdatePrompt />
            <InstallPrompt />
        </LightErrorBoundary>
    );
}
