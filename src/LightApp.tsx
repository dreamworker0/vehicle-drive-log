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

// 랜딩은 LCP를 결정하는 화면이라 정적으로 둔다 — 여기에 lazy를 걸면 청크 왕복이 하나 더 붙는다.
import LandingPage from './components/auth/LandingPage';

const LoginPage = lazyWithRetry(() => import('./components/auth/LoginPage'));
// `/apply`만 AuthProvider(= Firestore)가 필요하다 — 그 래퍼째로 이 경로에서만 받는다.
const OrgApplicationRoute = lazyWithRetry(() => import('./components/auth/OrgApplicationRoute'));
const TermsPage = lazyWithRetry(() => import('./components/auth/TermsPage'));
const PrivacyPage = lazyWithRetry(() => import('./components/auth/PrivacyPage'));
const ReleaseNotesPage = lazyWithRetry(() => import('./components/auth/ReleaseNotesPage'));
const FAQPage = lazyWithRetry(() => import('./components/auth/FAQPage'));
// 설치·업데이트 안내는 첫 페인트에 필요 없다. InstallPrompt는 lib/firebase(Analytics)를
// 끌어오므로 정적으로 두면 랜딩이 Firebase를 다시 물고 온다.
const UpdatePrompt = lazyWithRetry(() => import('./components/common/UpdatePrompt'));
const InstallPrompt = lazyWithRetry(() => import('./components/common/InstallPrompt'));

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
        <>
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

            {/*
                안내 배너는 **라우트와 다른 Suspense 경계**에 둔다.
                같은 경계에 넣었더니 이 둘이 지연 로딩되는 동안 React가 **경계 전체를**
                fallback으로 바꿔, 이미 그려진 랜딩까지 스피너로 덮였다(모바일 E2E가 잡았다 —
                버튼이 보였다가 사라졌다). 화면 위에 겹쳐 뜨는 부가 UI가 본문을 가리면 안 되므로
                각자 경계를 두고 fallback도 두지 않는다.
            */}
            <Suspense fallback={null}><UpdatePrompt /></Suspense>
            <Suspense fallback={null}><InstallPrompt /></Suspense>
        </>
    );
}
