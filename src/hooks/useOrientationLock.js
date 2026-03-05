import { useEffect } from 'react';

/**
 * PWA에서 무조건 세로모드(portrait)를 잠그는 훅.
 *
 * Screen Orientation API(`screen.orientation.lock`)를 사용하며,
 * API가 지원되지 않거나 권한이 없는 환경에서는 조용히 무시합니다.
 */
export function useOrientationLock() {
    useEffect(() => {
        const so = screen.orientation;
        if (!so || typeof so.lock !== 'function') return;

        so.lock('portrait-primary').catch(() => {
            // API 미지원이거나 권한 없음 — 무시
        });
    }, []);
}
