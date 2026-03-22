/**
 * appEntry — 인증된 사용자용 전체 앱 엔트리포인트
 *
 * main.tsx에서 Firebase Auth 상태 확인 후 인증 사용자일 때 동적 import됨.
 * AuthProvider, 전체 라우팅, Sentry, HelmetProvider 등 포함.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { AuthProvider } from './hooks/useAuth';
import { ToastProviderWrapper } from './hooks/ToastProvider';
import ErrorBoundary from './components/common/ErrorBoundary';
import OfflineBanner from './components/common/OfflineBanner';
import App from './App';
import UpdatePrompt from './components/common/UpdatePrompt';
import InstallPrompt from './components/common/InstallPrompt';

// Sentry 지연 초기화
import('./lib/sentry').then(m => m.initSentry()).catch(() => { });

export function renderFullApp() {
    const root = document.getElementById('root')!;
    createRoot(root).render(
        <StrictMode>
            <HelmetProvider>
                <BrowserRouter>
                    <ErrorBoundary>
                        <ToastProviderWrapper>
                            <AuthProvider>
                                <OfflineBanner />
                                <App />
                                <UpdatePrompt />
                                <InstallPrompt />
                            </AuthProvider>
                        </ToastProviderWrapper>
                    </ErrorBoundary>
                </BrowserRouter>
            </HelmetProvider>
        </StrictMode>,
    );
}
