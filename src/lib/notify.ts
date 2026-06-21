import { useToastStore, type ToastType } from '../store/useToastStore';

/**
 * React 컴포넌트 밖(모듈 스코프)에서 사용자에게 알림을 띄우기 위한 브릿지.
 *
 * Zustand 스토어는 React 외부에서도 `getState()`로 접근 가능하므로,
 * `firebase.ts`처럼 훅을 쓸 수 없는 비-React 모듈에서 `window.alert` 대신
 * 이 함수를 사용한다. 화면 표시는 `ToastProviderWrapper`가 담당하며,
 * 앱 런타임에는 항상 마운트되어 있다(미마운트 시 토스트는 마운트 직후 표시됨).
 *
 * @param message 사용자에게 보여줄 메시지
 * @param type    토스트 종류(기본 'info')
 * @param durationMs 표시 시간(ms). 안내성 알림은 길게 잡는다(기본 8초).
 */
export function notifyUser(message: string, type: ToastType = 'info', durationMs = 8000): void {
    try {
        useToastStore.getState().showToast(message, type, { duration: durationMs });
    } catch {
        // 스토어 접근 불가(예: 테스트/SSR 환경) 시 콘솔로 폴백
        console.warn('[notify]', message);
    }
}
