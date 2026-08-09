/**
 * lightEntry — 비인증 사용자용 경량 엔트리포인트
 *
 * main.tsx에서 Firebase Auth 상태 확인 후 비인증 사용자일 때 동적 import됨.
 * AuthProvider, Firestore 리스너, Sentry 등 무거운 모듈을 제외하고
 * 랜딩·로그인·기관 신청 등 비인증 화면만 담는다.
 *
 * 로그인 성공 시 전체 앱(appEntry)으로 전환한다.
 *
 * 화면 구성은 `LightApp.tsx`에 있다 — 이 파일은 마운트와 앱 전환만 맡는다
 * (appEntry.tsx ↔ App.tsx와 같은 분담).
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './lib/firebaseAuth';
import { ToastProviderWrapper } from './hooks/ToastProvider';
import ThemeRoot from './components/common/ThemeRoot';
import LightApp from './LightApp';

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
            {/* 테마 소유자 — dark 클래스·theme-color를 스토어(+강제 라이트)에 맞춘다 */}
            <ThemeRoot>
                <BrowserRouter>
                    {/* 커스텀 토스트는 zustand 스토어만 사용하는 경량 컴포넌트 —
                        랜딩 문의 폼 등 비인증 경로의 토스트 표시를 위해 경량 엔트리에도 마운트 */}
                    <ToastProviderWrapper>
                        <LightApp />
                    </ToastProviderWrapper>
                </BrowserRouter>
            </ThemeRoot>
        </StrictMode>,
    );
}
