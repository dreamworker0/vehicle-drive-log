/**
 * LightApp — 비인증 화면의 라우팅 껍데기
 *
 * 고정하는 것은 **무엇을 지연 로딩하면 안 되는가**다.
 *
 * 랜딩 LCP를 줄이려고 이 파일의 거의 모든 것을 지연 로딩으로 돌렸는데, 그때
 * `UpdatePrompt`·`InstallPrompt`까지 같이 넘겼다. 둘은 화면을 그리지 않는(null 반환)
 * 컴포넌트라 "첫 페인트에 필요 없다"로 보였지만, 실제로 하는 일은 **타이밍이 있는 부수효과**다.
 *   - UpdatePrompt → `registerSW()` : 서비스 워커 등록(= 오프라인 캐시가 생기는 지점)
 *   - InstallPrompt → `beforeinstallprompt` 리스너 : 이 이벤트는 한 번만, 이르게 온다
 * 지연 로딩하면 청크가 도착할 때까지 둘 다 일어나지 않고, 청크를 못 받으면 아예 일어나지 않는다.
 *
 * 렌더 테스트로는 이 차이를 잡을 수 없어(둘 다 null을 반환하니 화면이 같다) 소스에서 고정한다.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
// 소스 자체를 읽는다 — 지연 로딩 여부는 렌더 결과에 드러나지 않는다(아래 주석 참고)
import SOURCE from '../../LightApp.tsx?raw';

describe('부수효과가 있는 컴포넌트는 지연 로딩하지 않는다', () => {
    it.each([
        ['UpdatePrompt', '서비스 워커 등록(registerSW)'],
        ['InstallPrompt', 'beforeinstallprompt 리스너 등록'],
    ])('%s는 정적으로 import한다 — %s이 청크 도착에 묶이면 안 된다', (name) => {
        expect(SOURCE).toMatch(
            new RegExp(`^import\\s+${name}\\s+from\\s+'\\./components/common/${name}';$`, 'm'),
        );
        // lazy/lazyWithRetry로 되돌아가지 않았는지도 함께 본다
        expect(SOURCE).not.toMatch(new RegExp(`const\\s+${name}\\s*=\\s*lazy`));
    });
});

vi.mock('../../components/auth/LandingPage', () => ({
    default: () => <div data-testid="landing">랜딩 본문</div>,
}));
vi.mock('../../components/common/UpdatePrompt', () => ({ default: () => null }));
vi.mock('../../components/common/InstallPrompt', () => ({ default: () => null }));

import LightApp from '../../LightApp';

describe('랜딩 렌더', () => {
    it('랜딩 본문을 그리고, 라우트 자리표시자는 남기지 않는다', async () => {
        render(
            <MemoryRouter initialEntries={['/']}>
                <LightApp />
            </MemoryRouter>,
        );

        expect(await screen.findByTestId('landing')).toBeVisible();
        expect(screen.queryByRole('status', { name: '페이지를 불러오는 중' })).not.toBeInTheDocument();
    });
});
