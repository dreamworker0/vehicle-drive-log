import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import useSettingsModals from '../../hooks/useSettingsModals';

describe('useSettingsModals', () => {
    it('초기값은 모두 false', () => {
        const { result } = renderHook(() => useSettingsModals());
        expect(result.current.showFeedback).toBe(false);
        expect(result.current.showManual).toBe(false);
        expect(result.current.showAskAI).toBe(false);
        expect(result.current.showWithdraw).toBe(false);
    });

    it('각 모달의 open/close 상태 전이가 독립적으로 동작', () => {
        const { result } = renderHook(() => useSettingsModals());

        act(() => result.current.setShowFeedback(true));
        expect(result.current.showFeedback).toBe(true);
        expect(result.current.showManual).toBe(false);

        act(() => result.current.setShowManual(true));
        act(() => result.current.setShowFeedback(false));
        expect(result.current.showFeedback).toBe(false);
        expect(result.current.showManual).toBe(true);
    });
});
