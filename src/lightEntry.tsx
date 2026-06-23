/**
 * lightEntry — 비인증 사용자용 경량 엔트리포인트
 *
 * main.tsx에서 Firebase Auth 상태 확인 후 비인증 사용자일 때 동적 import됨.
 * AuthProvider, Firestore 리스너, Sentry 등 무거운 모듈을 제외하고
 * LandingPage, LoginPage, OrgApplicationPage만 포함.
 *
 * 로그인 성공 시 window.location.reload()로 전체 앱(appEntry)으로 전환.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './lib/firebaseAuth';
import { AuthProvider } from './hooks/useAuth';
import UpdatePrompt from './components/common/UpdatePrompt';
import InstallPrompt from './components/common/InstallPrompt';
import InAppBrowserWarning from './components/common/InAppBrowserWarning';
import { isInAppBrowser } from './lib/inAppBrowser';

// 경량 모드에서는 lazy loading 없이 직접 import (번들 자체가 작으므로)
import LandingPage from './components/auth/LandingPage';
import LoginPage from './components/auth/LoginPage';
import OrgApplicationPage from './components/auth/OrgApplicationPage';
import TermsPage from './components/auth/TermsPage';
import PrivacyPage from './components/auth/PrivacyPage';
import ReleaseNotesPage from './components/auth/ReleaseNotesPage';
import FAQPage from './components/auth/FAQPage';

export function renderLightApp() {
    const rootEl = document.getElementById('root')!;

    const lightRoot = createRoot(rootEl);

    // 인앱 브라우저(카톡·네이버 등)에서는 구글 로그인이 차단(disallowed_useragent)되므로
    // 라우터/로그인 화면 대신 외부 브라우저 안내 화면만 표시한다.
    // (appEntry의 App.tsx와 동일한 가드 — 비로그인 사용자도 반드시 안내받도록)
    if (isInAppBrowser()) {
        lightRoot.render(
            <StrictMode>
                <InAppBrowserWarning />
            </StrictMode>,
        );
        return;
    }

    // 로그인 성공 감지 → 전체 앱으로 전환
    const unsubscribe = onAuthStateChanged(auth, (user) => {
        if (user && !user.isAnonymous) {
            unsubscribe();
            // 전체 앱으로 전환 (appEntry 로드)
            import('./appEntry').then(({ renderFullApp }) => {
                // React 공식 unmount로 안전하게 DOM 정리 (innerHTML 직접 조작 금지)
                lightRoot.unmount();
                renderFullApp();
            });
        }
    });

    lightRoot.render(
        <StrictMode>
            <BrowserRouter>
                <AuthProvider>
                    <Routes>
                        <Route path="/" element={<LandingPage />} />
                        <Route path="/login" element={<LoginPage />} />
                        <Route path="/apply" element={<OrgApplicationPage />} />
                        <Route path="/terms" element={<TermsPage />} />
                        <Route path="/privacy" element={<PrivacyPage />} />
                        <Route path="/release-notes" element={<ReleaseNotesPage />} />
                        <Route path="/faq" element={<FAQPage />} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                    <UpdatePrompt />
                    <InstallPrompt />
                </AuthProvider>
            </BrowserRouter>
        </StrictMode>,
    );
}
