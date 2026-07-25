import { useEffect } from 'react';
import { useThemeStore } from '../store/useThemeStore';

/**
 * 공개 페이지(랜딩, 로그인, 기관 신청, 약관, 개인정보, 릴리즈노트, FAQ)에서
 * 다크모드를 강제로 비활성화합니다.
 *
 * DOM을 직접 만지지 않고 스토어의 `forceLightCount`만 올립니다(언마운트 시 내림).
 * 실제 `<html>`의 dark 클래스 적용은 [useThemeSync]가 단독으로 수행하며, 그쪽이
 * `theme`과 이 카운터를 함께 보고 결정합니다.
 *
 * 왜 DOM을 직접 만지지 않는가: 예전엔 이 훅이 마운트 시 dark를 직접 제거했는데,
 * React effect가 자식→부모 순이라 체류 중 테마가 바뀌면 부모인 useThemeSync가 나중에
 * 실행되어 dark를 다시 붙였다(공개 페이지가 보는 중에 다크로 전환). 또 dark를 쓰는
 * 주체가 둘이라, 마운트 시점 스냅샷 복원이 스토어와 어긋나는 desync도 있었다.
 * 쓰는 주체를 useThemeSync 하나로 모아 두 문제를 함께 없앴다.
 *
 * 카운터인 이유: 공개 화면이 동시에 여러 개 마운트될 수 있고(가드 래퍼 등), 하나가
 * 언마운트돼도 남은 화면의 요구가 유지되어야 한다.
 */
export default function useForceLightMode() {
    useEffect(() => {
        const { pushForceLight, popForceLight } = useThemeStore.getState();
        pushForceLight();
        return () => popForceLight();
    }, []);
}
