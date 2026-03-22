import { useConfirmStore } from '../store/useConfirmStore';

export function useConfirm() {
    const confirm = useConfirmStore(state => state.confirm);
    return { confirm };
}
