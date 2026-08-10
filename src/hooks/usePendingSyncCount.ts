import { useEffect, useState } from 'react';
import { getPendingCount } from '../lib/offline/syncQueue';

/** 폴링 간격 — 배너 숫자가 굼떠 보이지 않을 만큼 짧고, IDB를 계속 두드리지 않을 만큼 길게 */
const POLL_MS = 3000;

/**
 * 아직 서버에 올라가지 못한 오프라인 큐 항목 수.
 *
 * **왜 폴링인가.** 큐에 쌓는 쪽은 페이지지만 비우는 쪽은 서비스워커다(Background Sync).
 * 두 컨텍스트는 모듈 인스턴스가 분리돼 있어 공유할 변경 이벤트가 없다. IndexedDB를 세는
 * 것은 값싼 읽기라, 상태를 억지로 동기화하는 장치를 새로 만드는 것보다 이쪽이 단순하다.
 *
 * **볼 이유가 없을 때는 돌지 않는다.** 온라인이고 남은 것이 0이면 타이머를 걸지 않고,
 * 오프라인 전환·온라인 복귀·화면 복귀 때 다시 확인한다. 화면이 가려진 동안 SW가 큐를
 * 비웠을 수 있으므로 visibilitychange도 계기로 삼는다.
 */
export default function usePendingSyncCount(): number {
    const [count, setCount] = useState(0);

    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const refresh = async () => {
            const next = await getPendingCount();
            if (cancelled) return;
            setCount(next);
            // 남은 것이 있거나 오프라인이면 계속 지켜본다.
            if (next > 0 || !navigator.onLine) {
                timer = setTimeout(refresh, POLL_MS);
            }
        };

        // 이벤트로 들어온 확인 요청은 진행 중인 타이머를 지우고 즉시 다시 시작한다
        // (그대로 두면 타이머가 겹쳐 폴링이 두 배로 돈다).
        const kick = () => {
            clearTimeout(timer);
            void refresh();
        };

        void refresh();
        window.addEventListener('online', kick);
        window.addEventListener('offline', kick);
        document.addEventListener('visibilitychange', kick);

        return () => {
            cancelled = true;
            clearTimeout(timer);
            window.removeEventListener('online', kick);
            window.removeEventListener('offline', kick);
            document.removeEventListener('visibilitychange', kick);
        };
    }, []);

    return count;
}
