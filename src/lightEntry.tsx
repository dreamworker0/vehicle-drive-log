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
import { ToastProviderWrapper } from './hooks/ToastProvider';
import UpdatePrompt from './components/common/UpdatePrompt';
import InstallPrompt from './components/common/InstallPrompt';
import InAppBrowserGuard from './components/common/InAppBrowserGuard';

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
                    {/* 커스텀 토스트는 zustand 스토어만 사용하는 경량 컴포넌트 —
                        랜딩 문의 폼 등 비인증 경로의 토스트 표시를 위해 경량 엔트리에도 마운트 */}
                    <ToastProviderWrapper>
                        <Routes>
                            <Route path="/" element={<LandingPage />} />
                            {/* 인앱 브라우저에서는 외부 브라우저 안내로 대체 (랜딩 등 다른 라우트는 그대로 노출) */}
                            <Route path="/login" element={<InAppBrowserGuard><LoginPage /></InAppBrowserGuard>} />
                            <Route path="/apply" element={<OrgApplicationPage />} />
                            <Route path="/terms" element={<TermsPage />} />
                            <Route path="/privacy" element={<PrivacyPage />} />
                            <Route path="/release-notes" element={<ReleaseNotesPage />} />
                            <Route path="/faq" element={<FAQPage />} />
                            <Route path="*" element={<Navigate to="/" replace />} />
                        </Routes>
                        <UpdatePrompt />
                        <InstallPrompt />
                    </ToastProviderWrapper>
                </AuthProvider>
            </BrowserRouter>
        </StrictMode>,
    );
}
