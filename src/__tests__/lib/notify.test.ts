import { describe, it, expect, beforeEach } from 'vitest';
import { notifyUser } from '../../lib/notify';
import { useToastStore } from '../../store/useToastStore';

describe('notifyUser (React 외부 토스트 브릿지)', () => {
    beforeEach(() => {
        useToastStore.setState({ toasts: [] });
    });

    it('토스트 스토어에 메시지를 추가한다', () => {
        notifyUser('테스트 메시지', 'error');
        const toasts = useToastStore.getState().toasts;
        expect(toasts).toHaveLength(1);
        expect(toasts[0].message).toBe('테스트 메시지');
        expect(toasts[0].type).toBe('error');
    });

    it('기본 타입은 info다', () => {
        notifyUser('기본 타입');
        expect(useToastStore.getState().toasts[0].type).toBe('info');
    });

    it('여러 번 호출하면 누적된다', () => {
        notifyUser('첫번째', 'warning');
        notifyUser('두번째', 'success');
        const toasts = useToastStore.getState().toasts;
        expect(toasts).toHaveLength(2);
        expect(toasts.map(t => t.message)).toEqual(['첫번째', '두번째']);
    });
});
