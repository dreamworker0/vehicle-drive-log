import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

// screen.orientation mock
Object.defineProperty(window, 'screen', {
    value: {
        orientation: {
            lock: vi.fn().mockRejectedValue(new Error('not supported')),
        },
    },
    writable: true,
});

import { useOrientationLock } from '../../hooks/useOrientationLock';

describe('useOrientationLock', () => {
    it('마운트 시 screen.orientation.lock을 호출한다', () => {
        renderHook(() => useOrientationLock());

        expect((screen.orientation as unknown as { lock: unknown }).lock).toHaveBeenCalledWith('portrait-primary');
    });

    it('lock이 실패해도 에러를 던지지 않는다', () => {
        expect(() => {
            renderHook(() => useOrientationLock());
        }).not.toThrow();
    });

    it('lock이 없는 환경에서도 안전하다', () => {
        const original = screen.orientation;
        Object.defineProperty(window, 'screen', {
            value: { orientation: {} },
            writable: true,
        });

        expect(() => {
            renderHook(() => useOrientationLock());
        }).not.toThrow();

        Object.defineProperty(window, 'screen', {
            value: original,
            writable: true,
        });
    });
});
