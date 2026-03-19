import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { AuthProvider } from './hooks/useAuth';
import { ToastProviderWrapper } from './hooks/useToast';
import ErrorBoundary from './components/common/ErrorBoundary';
import OfflineBanner from './components/common/OfflineBanner';
// Sentry 지연 초기화 — 초기 번들에서 @sentry/react 제외
import('./lib/sentry').then(m => m.initSentry()).catch(() => { });
import App from './App';
import UpdatePrompt from './components/common/UpdatePrompt';
import InstallPrompt from './components/common/InstallPrompt';
import './index.css';

createRoot(document.getElementById('root')!).render(
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

