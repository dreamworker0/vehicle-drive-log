import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { isUpdateReady } from '../lib/pendingUpdate';
import { reloadPage } from '../lib/browserNav';
import { useToastStore } from '../store/useToastStore';

/**
 * 새 버전이 준비된 뒤 사용자가 **다른 화면으로 옮기면** 그 화면을 새 버전으로 연다.
 *
 * 화면을 옮기는 순간은 어차피 지금 화면을 떠나는 때라, 작성 중이던 입력이 날아갈 걱정이
 * 없다. 사용자는 업데이트된 줄 모르고 넘어가고, 옛 파일을 못 찾아 오류가 나는 일도 막는다.
 * (탭이 숨겨질 때 새로고침하는 방식은 쓰지 않는다 — 다른 앱을 잠깐 보고 돌아오면 쓰던 폼이
 * 사라진다.)
 *
 * 새로고침하지 않고 넘기는 경우(다음 화면 이동 때 다시 본다):
 * - 오프라인: 새 버전 파일을 받을 수 없어 오히려 화면이 깨진다.
 * - 토스트가 떠 있음: "저장했어요" 같은 안내를 띄우고 화면을 옮기는 흐름이 많다.
 *   새로고침하면 그 안내가 사라져 저장이 됐는지 알 수 없게 된다.
 *
 * 경로(pathname)가 바뀔 때만 본다 — 같은 화면 안의 검색어·필터(?query) 변경은 해당하지 않는다.
 * 화면 사이로 넘기던 `location.state`는 브라우저 history에 들어 있어 새로고침 뒤에도 남는다.
 */
export function useApplyUpdateOnNavigation(): void {
    const { pathname } = useLocation();
    const previous = useRef(pathname);

    useEffect(() => {
        if (previous.current === pathname) return;
        previous.current = pathname;

        if (!isUpdateReady()) return;
        if (!navigator.onLine) return;
        if (useToastStore.getState().toasts.length > 0) return;

        reloadPage();
    }, [pathname]);
}
