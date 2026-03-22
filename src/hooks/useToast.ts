import { useToastStore } from '../store/useToastStore';

export function useToast() {
    const showToast = useToastStore(state => state.showToast);
    return { showToast };
}
