import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isStaleChunkError, STALE_CHUNK_MESSAGE } from '../../lib/staleChunk';
import { useToastStore } from '../../store/useToastStore';

/**
 * 배포 직후 구버전 탭에서 내보내기 모듈을 못 받았을 때, 브라우저 원문 대신
 * 새로고침 안내 + [새로고침] 버튼이 뜨는지 고정한다 (2026-10-12 기관 문의).
 */
describe('isStaleChunkError', () => {
    it.each([
        ['Chrome', new TypeError('Failed to fetch dynamically imported module: https://vehicle-drive-log.web.app/assets/excelExport-C_yf1lx3.js')],
        ['Firefox', new TypeError('error loading dynamically imported module: https://x/assets/a.js')],
        ['Safari', new TypeError('Importing a module script failed.')],
        ['MIME', "Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of \"text/html\". Strict MIME type checking is enforced for module scripts per HTML spec. is not a valid JavaScript MIME type"],
        ['Vite CSS', new Error('Unable to preload CSS for /assets/a.css')],
    ])('%s 원문을 알아본다', (_label, value) => {
        expect(isStaleChunkError(value)).toBe(true);
    });

    it('다른 오류는 건드리지 않는다', () => {
        expect(isStaleChunkError(new Error('boom'))).toBe(false);
        expect(isStaleChunkError('데이터를 불러오는데 실패했습니다.')).toBe(false);
        expect(isStaleChunkError(null)).toBe(false);
        expect(isStaleChunkError(undefined)).toBe(false);
    });
});

describe('useToastStore — 구버전 청크 안내', () => {
    beforeEach(() => {
        useToastStore.setState({ toasts: [] });
    });

    it('원문 대신 안내 문구와 [새로고침] 버튼을 띄운다', () => {
        useToastStore.getState().showToast('Failed to fetch dynamically imported module: https://x/assets/a.js', 'error');
        const [toast] = useToastStore.getState().toasts;
        expect(toast.message).toBe(STALE_CHUNK_MESSAGE);
        expect(toast.type).toBe('warning');
        expect(toast.actionLabel).toBe('새로고침');
    });

    it('[새로고침]을 누르면 페이지를 다시 불러온다', () => {
        const reload = vi.fn();
        vi.stubGlobal('location', { ...window.location, reload });
        try {
            useToastStore.getState().showToast(STALE_CHUNK_MESSAGE, 'error');
            useToastStore.getState().toasts[0].onAction?.();
            expect(reload).toHaveBeenCalledOnce();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('이미 떠 있으면 겹쳐 띄우지 않는다', () => {
        const { showToast } = useToastStore.getState();
        showToast('Failed to fetch dynamically imported module: https://x/assets/a.js', 'error');
        showToast(STALE_CHUNK_MESSAGE, 'error');
        expect(useToastStore.getState().toasts).toHaveLength(1);
    });

    it('일반 토스트는 그대로 둔다', () => {
        useToastStore.getState().showToast('저장했어요', 'success');
        const [toast] = useToastStore.getState().toasts;
        expect(toast.message).toBe('저장했어요');
        expect(toast.actionLabel).toBeNull();
    });
});
