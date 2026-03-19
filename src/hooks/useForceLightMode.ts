import { useEffect } from 'react';

/**
 * 공개 페이지(랜딩, 로그인, 기관 신청)에서 다크모드를 강제로 비활성화합니다.
 * 마운트 시 dark 클래스를 제거하고, 언마운트 시 원래 상태를 복원합니다.
 */
export default function useForceLightMode() {
    useEffect(() => {
        const root = document.documentElement;
        const wasDark = root.classList.contains('dark');

        // 강제 라이트모드
        root.classList.remove('dark');

        return () => {
            // 원래 다크모드였으면 복원
            if (wasDark) {
                root.classList.add('dark');
            }
        };
    }, []);
}
