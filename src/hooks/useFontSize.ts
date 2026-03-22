import { useFontSizeStore } from '../store/useFontSizeStore';

export function useFontSize() {
    const fontSize = useFontSizeStore(state => state.fontSize);
    const setSize = useFontSizeStore(state => state.setSize);
    
    return { fontSize, setSize };
}
