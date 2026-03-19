import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useToast } from './useToast';

/** 루트 경로 목록 — 뒤로가기 시 앱 종료 방지 대상 */
const ROOT_PATHS = ['/employee', '/employee/today', '/admin', '/super-admin'];

/**
 * 안드로이드 뒤로가기 버튼 처리 훅.
 *
 * - 루트 경로에서 뒤로가기 → "한 번 더 누르면 종료합니다" 토스트 후 2초 대기
 * - 2초 이내 재클릭 → 기본 동작(앱 종료) 허용
 * - 루트가 아닌 경로 → 이전 화면으로 정상 이동
 */
export default function useBackButton() {
    const location = useLocation();
    const navigate = useNavigate();
    const { showToast } = useToast();
    const backPressedRef = useRef(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    useEffect(() => {
        // standalone 모드(PWA 설치)에서만 활성화
        const isStandalone =
            window.matchMedia?.('(display-mode: standalone)')?.matches ||
            navigator.standalone ||
            document.referrer?.includes('android-app://');

        if (!isStandalone) return;

        // 루트 경로에 진입할 때 history에 더미 항목 추가 (뒤로가기 잡기용)
        const isRoot = ROOT_PATHS.includes(location.pathname);
        if (isRoot) {
            window.history.pushState({ guard: true }, '');
        }

        const handlePopState = (e: PopStateEvent) => {
            const currentPath = window.location.pathname;
            const atRoot = ROOT_PATHS.includes(currentPath);

            if (!atRoot) return; // 루트가 아니면 기본 동작(이전 화면)

            if (backPressedRef.current) {
                // 2초 이내 두 번째 뒤로가기 → 앱 종료 허용 (히스토리 비움)
                clearTimeout(timerRef.current);
                backPressedRef.current = false;
                return; // popstate 기본 동작으로 앱 종료
            }

            // 첫 번째 뒤로가기 → 방지 + 토스트
            e.preventDefault?.();
            window.history.pushState({ guard: true }, '');
            backPressedRef.current = true;
            showToast('뒤로 가기를 한 번 더 누르면 앱을 종료합니다.', 'info');

            timerRef.current = setTimeout(() => {
                backPressedRef.current = false;
            }, 2000);
        };

        window.addEventListener('popstate', handlePopState);
        return () => {
            window.removeEventListener('popstate', handlePopState);
            clearTimeout(timerRef.current);
        };
    }, [location.pathname, navigate, showToast]);
}
