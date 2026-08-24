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

// 본 웹 폰트는 이 엔트리에서만 붙인다 (공개 랜딩은 폴백 서체로 빠르게 — 근거는 webFont.ts)
import { loadWebFont } from './lib/webFont';
loadWebFont();

// Sentry 지연 초기화
import('./lib/sentry').then(m => m.initSentry()).catch(() => { });

// iOS 등 Background Sync 미지원 브라우저용 오프라인 큐 flush 폴백
import { registerReconnectFlush } from './lib/offline/syncQueue';
registerReconnectFlush();

// 오프라인 큐에서 폐기된(서버에 반영되지 못한) 기록을 사용자에게 알린다
import { registerSyncFailureNotice } from './lib/offline/syncFailureNotice';
registerSyncFailureNotice();

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
