import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import ErrorBoundary from '../../components/common/ErrorBoundary';
import LightErrorBoundary from '../../components/common/LightErrorBoundary';
import { reloadPage } from '../../lib/browserNav';

vi.mock('../../lib/browserNav', () => ({ reloadPage: vi.fn(), navigateTo: vi.fn(), currentHref: vi.fn(() => '') }));
vi.mock('../../lib/sentry', () => ({ captureError: vi.fn() }));

/**
 * 오류 경계가 "배포로 옛 파일이 사라진 오류"를 만나면 고장 화면 대신 새 버전 안내를 띄운다.
 *
 * 업데이트 직후 옛 화면이 새 파일을 못 찾으면 "😥 문제가 발생했습니다"가 떴고, 실무자는
 * 이를 장애로 받아들였다. 원인이 업데이트일 때만 안내를 바꾸고, 다른 오류는 그대로 둔다.
 */
const STALE = new TypeError('Failed to fetch dynamically imported module: https://vehicle-drive-log.web.app/assets/LogManager-C_yf1lx3.js');
const OTHER = new Error('Cannot read properties of undefined');

function Thrower({ error }: { error: Error }): never {
    throw error;
}

function setNavigatorOnline(value: boolean) {
    Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
}

const BOUNDARIES = [
    ['ErrorBoundary(전체 앱)', ErrorBoundary],
    ['LightErrorBoundary(로그인 전 화면)', LightErrorBoundary],
] as const;

describe.each(BOUNDARIES)('%s', (_label, Boundary) => {
    beforeEach(() => {
        vi.mocked(reloadPage).mockClear();
        setNavigatorOnline(true);
        // React가 잡힌 예외를 콘솔에 찍는다 — 의도한 예외라 출력을 막는다
        vi.spyOn(console, 'error').mockImplementation(() => { });
    });
    afterEach(() => {
        vi.restoreAllMocks();
        setNavigatorOnline(true);
    });

    it('옛 파일을 못 찾은 오류면 "새 버전이 나왔어요" 안내를 띄운다', () => {
        render(<Boundary><Thrower error={STALE} /></Boundary>);

        expect(screen.getByRole('heading', { name: '새 버전이 나왔어요' })).toBeVisible();
        expect(screen.queryByText('문제가 발생했습니다')).not.toBeInTheDocument();
    });

    it('[새 버전으로 열기]를 누르면 새로고침한다', async () => {
        render(<Boundary><Thrower error={STALE} /></Boundary>);

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '새 버전으로 열기' }));
        });

        expect(reloadPage).toHaveBeenCalledTimes(1);
    });

    it('다른 오류는 기존 오류 화면을 그대로 쓴다', () => {
        render(<Boundary><Thrower error={OTHER} /></Boundary>);

        expect(screen.queryByText('새 버전이 나왔어요')).not.toBeInTheDocument();
    });

    it('오프라인이면 업데이트로 단정하지 않는다 — 회선 단절도 같은 원문으로 온다', () => {
        setNavigatorOnline(false);
        render(<Boundary><Thrower error={STALE} /></Boundary>);

        expect(screen.queryByText('새 버전이 나왔어요')).not.toBeInTheDocument();
    });
});
