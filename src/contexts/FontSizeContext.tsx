import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

type FontSize = 'small' | 'normal' | 'large';

interface FontSizeContextType {
    fontSize: FontSize;
    setSize: (size: FontSize) => void;
}

const FontSizeContext = createContext<FontSizeContextType | null>(null);

const STORAGE_KEY = 'font-size-preference';
const VALID_SIZES: FontSize[] = ['small', 'normal', 'large'];

export function FontSizeProvider({ children }: { children: ReactNode }) {
    const [fontSize, setFontSize] = useState<FontSize>(() => {
        const stored = localStorage.getItem(STORAGE_KEY) as FontSize | null;
        return (stored && VALID_SIZES.includes(stored)) ? stored : 'normal';
    });

    // <html>에 font-size class 적용
    useEffect(() => {
        const root = document.documentElement;
        // 이전 class 제거
        root.classList.remove('font-small', 'font-normal', 'font-large');
        // 새 class 추가
        root.classList.add(`font-${fontSize}`);
        localStorage.setItem(STORAGE_KEY, fontSize);
    }, [fontSize]);

    const setSize = useCallback((size: FontSize) => {
        if (VALID_SIZES.includes(size)) setFontSize(size);
    }, []);

    return (
        <FontSizeContext.Provider value={{ fontSize, setSize }}>
            {children}
        </FontSizeContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useFontSize() {
    const ctx = useContext(FontSizeContext);
    if (!ctx) throw new Error('useFontSize must be used within FontSizeProvider');
    return ctx;
}
