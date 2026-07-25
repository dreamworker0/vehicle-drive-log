import { useEffect } from 'react';
import { useThemeStore } from '../store/useThemeStore';

/**
 * 공개 페이지(랜딩, 로그인, 기관 신청, 약관, 개인정보, 릴리즈노트, FAQ)에서
 * 다크모드를 강제로 비활성화합니다.
 * 마운트 시 dark 클래스를 제거하고, 언마운트 시 **스토어의 현재 테마로 재적용**합니다.
 *
 * 마운트 시점의 DOM 상태를 스냅샷으로 떠서 복원하지 않는 이유:
 * 페이지 체류 중 테마가 바뀌면 낡은 스냅샷이 dark를 되살리고, [useThemeSync]는
 * theme 값이 그대로라 재실행되지 않아 DOM↔스토어가 어긋난 채 남았다.
 * (가장 도달하기 쉬운 경로: 로그인 상태로 `/faq` 등에 딥링크 → App.tsx의 Firestore
 * 테마 동기화가 늦게 도착해 체류 중 setTheme 호출. App.tsx의 matchMedia 리스너도
 * 같은 결과를 내지만 `theme-preference` 미저장일 때만 발화한다.)
 * 언마운트 시점의 스토어 값을 단일 진실로 삼으면 이 desync 부류가 발생하지 않는다.
 *
 * ⚠️ 불변식: **lightEntry(비로그인 렌더 경로)의 모든 라우트가 이 훅을 써야 한다.**
 * 그 경로에는 [useThemeSync]가 마운트되지 않아 dark 클래스를 되돌릴 주체가 없고,
 * 이 훅의 cleanup이 dark를 켤 수 있는 유일한 경로다. 훅 없는 공개 라우트를 추가하면
 * 그 페이지에 dark가 영구 잔류할 수 있다(공개 페이지 배경에는 dark 변형이 없어
 * 밝은 배경 + 다크용 텍스트로 대비가 깨진다). 새 공개 라우트를 추가할 때 함께 호출할 것.
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
