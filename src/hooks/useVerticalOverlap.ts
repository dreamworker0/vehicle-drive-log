/**
 * useVerticalOverlap — 두 요소가 화면에서 세로로 겹치는지 감지하는 훅
 * 스크롤(캡처 단계)·리사이즈에 반응하며 rAF로 스로틀한다.
 */
import { useState, useRef, useEffect, useCallback, type RefObject } from 'react';

/**
 * 두 요소의 화면상 세로 범위가 겹치는지 boolean으로 반환한다.
 * @param refA 비교 대상 요소 A의 ref
 * @param refB 비교 대상 요소 B의 ref
 * @returns 두 요소가 세로로 겹치면 true
 */
export default function useVerticalOverlap(
    refA: RefObject<HTMLElement | null>,
    refB: RefObject<HTMLElement | null>,
): boolean {
    const [overlap, setOverlap] = useState(false);
    const rafRef = useRef<number | null>(null);

    const measure = useCallback(() => {
        const a = refA.current;
        const b = refB.current;
        if (!a || !b) { setOverlap(false); return; }
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        // 둘 다 보이는 영역을 가질 때만 겹침 판정
        const visible = ra.height > 0 && rb.height > 0;
        setOverlap(visible && ra.bottom > rb.top && ra.top < rb.bottom);
    }, [refA, refB]);

    useEffect(() => {
        const onScrollOrResize = () => {
            if (rafRef.current != null) return;
            rafRef.current = requestAnimationFrame(() => {
                rafRef.current = null;
                measure();
            });
        };
        measure(); // 초기 1회
        window.addEventListener('scroll', onScrollOrResize, { capture: true, passive: true });
        window.addEventListener('resize', onScrollOrResize);
        return () => {
            window.removeEventListener('scroll', onScrollOrResize, { capture: true } as EventListenerOptions);
            window.removeEventListener('resize', onScrollOrResize);
            if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
        };
    }, [measure]);

    return overlap;
}
