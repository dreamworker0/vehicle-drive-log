/**
 * LandingPage — 사용법 영상은 **누를 때** 불러온다
 *
 * 왜 고정하는가: 유튜브 iframe은 붙는 순간 플레이어 스크립트와 부속 요청을 끌어오고, 그
 * 대역폭이 랜딩의 CSR 렌더와 경쟁한다. 2026-08-24 러너 실측에서 LCP가 첫 페인트보다 4.2초
 * 늦었고(로컬 1.1초) 그 차이가 여기서 났다. `loading="lazy"`는 뷰포트 근처면 그대로 받으므로
 * 이 구간을 막지 못한다 — 실제로 그 속성을 달고도 러너에서 받고 있었다.
 *
 * 되돌아가기 쉬운 종류의 변경이라(iframe 한 줄을 다시 넣으면 끝) 렌더 결과로 못박는다.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../components/common/SEOHead', () => ({ default: () => null }));
vi.mock('../../components/common/PublicNav', () => ({ default: () => null }));

import LandingPage from '../../components/auth/LandingPage';

function renderLanding() {
    return render(
        <MemoryRouter>
            <LandingPage />
        </MemoryRouter>,
    );
}

describe('랜딩 사용법 영상', () => {
    it('첫 렌더에는 유튜브 iframe이 없다', () => {
        const { container } = renderLanding();
        expect(container.querySelector('iframe')).toBeNull();
    });

    it('버튼을 누르면 그때 유튜브 iframe이 붙는다', () => {
        const { container } = renderLanding();

        fireEvent.click(screen.getByRole('button', { name: /사용법 영상 보기/ }));

        const iframe = container.querySelector('iframe');
        expect(iframe).not.toBeNull();
        expect(iframe!.getAttribute('src')).toContain('youtube.com/embed/');
        // 누른 사람은 재생을 기대하므로 자동 재생으로 연다
        expect(iframe!.getAttribute('src')).toContain('autoplay=1');
    });
});
