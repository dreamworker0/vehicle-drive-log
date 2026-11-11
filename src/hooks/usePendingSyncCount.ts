import { useEffect, useState } from 'react';
import { getPendingCount, LEDGER_CHANGE_EVENT } from '../lib/offline/syncQueue';

/** 폴링 간격 — 배너 숫자가 굼떠 보이지 않을 만큼 짧고, IDB를 계속 두드리지 않을 만큼 길게 */
const POLL_MS = 3000;

/**
 * 장부에 새 줄이 적힌 뒤 세기까지 기다리는 시간. 정상 저장은 이 안에 서버 확인을 받아 줄이 지워진다 —
 * 곧바로 세면 저장할 때마다 "전송 중" 배너가 잠깐 깜빡인다. 이 시간이 지나도 남아 있으면 그때 보인다.
 */
const ADDED_GRACE_MS = 3000;

/**
 * 아직 서버 확인을 받지 못한 쓰기 수 (장부 줄 수 — syncQueue 머리 주석).
 *
 * **왜 폴링인가.** 다른 탭도 같은 장부(IndexedDB)에 적고 지운다. 탭 사이에는 공유할 변경 이벤트가
 * 없고, IndexedDB를 세는 것은 값싼 읽기라 상태를 억지로 동기화하는 장치보다 이쪽이 단순하다.
 *
 * **볼 이유가 없을 때는 돌지 않는다.** 온라인이고 남은 것이 0이면 타이머를 걸지 않고,
 * 오프라인 전환·온라인 복귀·화면 복귀·이 탭의 장부 변경(LEDGER_CHANGE_EVENT) 때 다시 확인한다.
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

        // 이 탭의 장부 변경 — 새 줄은 잠시 뒤에 센다(ADDED_GRACE_MS), 지워진 줄은 곧바로 반영한다
        let graceTimer: ReturnType<typeof setTimeout> | undefined;
        const onLedgerChange = (event: Event) => {
            const added = (event as CustomEvent<{ added?: boolean }>).detail?.added === true;
            if (!added) { kick(); return; }
            clearTimeout(graceTimer);
            graceTimer = setTimeout(kick, ADDED_GRACE_MS);
        };

        void refresh();
        window.addEventListener('online', kick);
        window.addEventListener('offline', kick);
        document.addEventListener('visibilitychange', kick);
        window.addEventListener(LEDGER_CHANGE_EVENT, onLedgerChange);

        return () => {
            cancelled = true;
            clearTimeout(timer);
            clearTimeout(graceTimer);
            window.removeEventListener('online', kick);
            window.removeEventListener('offline', kick);
            document.removeEventListener('visibilitychange', kick);
            window.removeEventListener(LEDGER_CHANGE_EVENT, onLedgerChange);
        };
    }, []);

    return count;
}
