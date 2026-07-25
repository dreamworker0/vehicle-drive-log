import { type ReactNode } from 'react';
import useThemeSync from '../../hooks/useThemeSync';

/**
 * 테마를 DOM에 반영하는 소유자 컴포넌트 — `<html>`의 dark 클래스와 `theme-color` 메타를
 * 스토어 값(+ 공개 페이지의 강제 라이트 요구)에 맞춘다.
 *
 * 경량 엔트리(`lightEntry.tsx`)에서 사용한다. appEntry는 `App` 본문에서
 * [useThemeSync]를 직접 호출하므로 이 래퍼가 필요하지 않다.
 *
 * 예전에는 경량 엔트리에 테마 소유자를 두지 않았다. useForceLightMode가 DOM을 직접
 * 만지던 시절엔 부모로 두면 effect 순서(자식→부모) 때문에 강제 라이트가 덮여 깨졌기
 * 때문이다. 지금은 dark를 쓰는 주체가 useThemeSync 하나뿐이고 강제 라이트는 카운터로
 * 전달되므로 순서와 무관하게 안전하다. 덕분에 비로그인 경로에서도 theme-color가 실제
 * 화면과 일치한다(이전에는 `index.html` 인라인 스크립트가 박은 다크 색상이 라이트
 * 화면에 그대로 남아 안드로이드에서 상태바만 어두웠다).
 */
export default function ThemeRoot({ children }: { children: ReactNode }) {
    useThemeSync();
    return <>{children}</>;
}
