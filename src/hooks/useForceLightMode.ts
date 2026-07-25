import { useEffect } from 'react';
import { useThemeStore } from '../store/useThemeStore';

/**
 * 공개 페이지(랜딩, 로그인, 기관 신청, FAQ)에서 다크모드를 강제로 비활성화합니다.
 * 마운트 시 dark 클래스를 제거하고, 언마운트 시 **스토어의 현재 테마로 재적용**합니다.
 *
 * 마운트 시점의 DOM 상태를 스냅샷으로 떠서 복원하지 않는 이유:
 * 페이지 체류 중 테마가 바뀌면(예: `theme-preference` 미저장 사용자의 OS 다크→라이트
 * 자동 전환 → matchMedia 리스너가 스토어 갱신) 낡은 스냅샷이 dark를 되살리고,
 * [useThemeSync]는 theme 값이 그대로라 재실행되지 않아 DOM↔스토어가 어긋난 채 남았다.
 * 언마운트 시점의 스토어 값을 단일 진실로 삼으면 이 desync 부류가 발생하지 않는다.
 */
export default function useForceLightMode() {
    useEffect(() => {
        const root = document.documentElement;

        // 강제 라이트모드
        root.classList.remove('dark');

        return () => {
            // 스토어의 현재 테마를 단일 진실로 재적용 (마운트 시점 스냅샷 아님)
            const { theme } = useThemeStore.getState();
            root.classList.toggle('dark', theme === 'dark');
        };
    }, []);
}
