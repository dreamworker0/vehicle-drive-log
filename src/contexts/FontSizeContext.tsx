import { useEffect, ReactNode } from 'react';
import { useFontSizeStore, type FontSize } from '../store/useFontSizeStore';

export function FontSizeProvider({ children }: { children: ReactNode }) {
    const fontSize = useFontSizeStore(state => state.fontSize);

    // <html>에 font-size class 적용
    useEffect(() => {
        const root = document.documentElement;
        // 이전 class 제거
        root.classList.remove('font-small', 'font-normal', 'font-large');
        // 새 class 추가
        root.classList.add(`font-${fontSize}`);
    }, [fontSize]);

    return <>{children}</>;
}

export function useFontSize() {
    const fontSize = useFontSizeStore(state => state.fontSize);
    const setSize = useFontSizeStore(state => state.setSize);
    
    return { fontSize, setSize };
}
