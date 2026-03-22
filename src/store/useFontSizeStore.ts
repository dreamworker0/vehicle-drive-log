import { create } from 'zustand';

export type FontSize = 'small' | 'normal' | 'large';

interface FontSizeState {
    fontSize: FontSize;
    setSize: (size: FontSize) => void;
}

const STORAGE_KEY = 'font-size-preference';
const VALID_SIZES: FontSize[] = ['small', 'normal', 'large'];

const getInitialFontSize = (): FontSize => {
    if (typeof window === 'undefined') return 'normal';
    const stored = localStorage.getItem(STORAGE_KEY) as FontSize | null;
    return (stored && VALID_SIZES.includes(stored)) ? stored : 'normal';
};

export const useFontSizeStore = create<FontSizeState>((set) => ({
    fontSize: getInitialFontSize(),
    setSize: (size: FontSize) => {
        if (VALID_SIZES.includes(size)) {
            localStorage.setItem(STORAGE_KEY, size);
            set({ fontSize: size });
        }
    },
}));
