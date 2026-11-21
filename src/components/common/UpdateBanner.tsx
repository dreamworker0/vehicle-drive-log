import { useEffect, useState, useSyncExternalStore } from 'react';
import { isUpdateReady, reloadToLatest, subscribeUpdateReady } from '../../lib/pendingUpdate';
import { useApplyUpdateOnNavigation } from '../../hooks/useApplyUpdateOnNavigation';

/**
 * 새 버전 안내 띠 — "새 버전이 나왔어요 [업데이트]".
 *
 * 새 서비스 워커가 활성화되면(`UpdatePrompt`의 onNeedReload → `markUpdateReady`) 화면 위쪽
 * 가운데에 작게 뜬다. **누를 때만** 새로고침한다 — 작성 중인 입력을 지키려고 자동 새로고침을
 * 하지 않는 정책(main.tsx)은 그대로다. 누르지 않아도 다음 화면 이동 때 새 버전이 적용된다
 * (`useApplyUpdateOnNavigation`). [닫기]는 이 탭에서 띠만 숨긴다.
 *
 * 위치를 위쪽으로 둔 이유: 아래쪽에는 하단 메뉴·저장 버튼·설치 안내(InstallPrompt)가 있어
 * 가리면 안 되는 것이 많다. 오프라인일 때는 업데이트할 수 없고 오프라인 띠가 같은 자리를
 * 쓰므로 숨긴다.
 */
export default function UpdateBanner() {
    useApplyUpdateOnNavigation();

    const ready = useSyncExternalStore(subscribeUpdateReady, isUpdateReady, () => false);
    const [online, setOnline] = useState(() => navigator.onLine);
    const [dismissed, setDismissed] = useState(false);
    const [updating, setUpdating] = useState(false);

    useEffect(() => {
        const on = () => setOnline(true);
        const off = () => setOnline(false);
        window.addEventListener('online', on);
        window.addEventListener('offline', off);
        return () => {
            window.removeEventListener('online', on);
            window.removeEventListener('offline', off);
        };
    }, []);

    if (!ready || !online || dismissed) return null;

    const handleUpdate = () => {
        setUpdating(true);
        void reloadToLatest();
    };

    return (
        <div
            role="status"
            aria-live="polite"
            className="fixed left-1/2 -translate-x-1/2 z-[9998] w-max max-w-[calc(100vw-2rem)] flex items-center gap-2 pl-4 pr-1.5 py-1.5 rounded-full shadow-lg bg-indigo-600 dark:bg-indigo-700 text-white text-sm font-medium animate-fade-in"
            style={{ top: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}
        >
            <span aria-hidden="true">✨</span>
            <span className="min-w-0">새 버전이 나왔어요</span>
            <button
                type="button"
                onClick={handleUpdate}
                disabled={updating}
                className="shrink-0 min-h-11 px-4 rounded-full bg-white text-indigo-700 font-semibold hover:bg-indigo-50 disabled:opacity-70 transition-colors"
            >
                {updating ? '업데이트 중…' : '업데이트'}
            </button>
            <button
                type="button"
                onClick={() => setDismissed(true)}
                aria-label="새 버전 안내 닫기"
                className="shrink-0 min-h-11 min-w-11 flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/15 transition-colors"
            >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
            </button>
        </div>
    );
}
