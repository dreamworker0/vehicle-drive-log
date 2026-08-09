/**
 * LightApp — 비인증 화면의 라우팅 껍데기
 *
 * 고정하는 것은 **Suspense 경계의 분리**다.
 *
 * 안내 배너(UpdatePrompt·InstallPrompt)를 라우트와 같은 Suspense 경계에 넣었더니,
 * 이 둘이 지연 로딩되는 동안 React가 **경계 전체를** fallback으로 바꿔 이미 그려진 랜딩까지
 * 스피너로 덮였다. 화면이 떴다가 통째로 사라졌다 다시 나타나는 셈이라, 첫인상이 가장
 * 중요한 랜딩에서 특히 나쁘다(2026-08-09 모바일 E2E가 "버튼이 보였다가 사라진다"로 잡았다).
 *
 * 아래 테스트는 배너를 **영원히 로딩 중인 상태**로 만들어 두고 랜딩이 그대로 남아 있는지 본다.
 * 경계를 다시 합치면 이 테스트가 실패한다.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../components/auth/LandingPage', () => ({
    default: () => <div data-testid="landing">랜딩 본문</div>,
}));

// 렌더 시점에 영원히 대기하는 컴포넌트 — Suspense 경계를 계속 붙잡는다.
// (vi.mock은 파일 상단으로 끌어올려지므로 팩토리 안에서 직접 만든다)
vi.mock('../../components/common/UpdatePrompt', () => ({
    default: () => { throw new Promise<void>(() => { /* 절대 resolve하지 않는다 */ }); },
}));
vi.mock('../../components/common/InstallPrompt', () => ({
    default: () => { throw new Promise<void>(() => { /* 절대 resolve하지 않는다 */ }); },
}));

import LightApp from '../../LightApp';

describe('Suspense 경계 분리', () => {
    it('안내 배너가 아직 로딩 중이어도 랜딩 본문은 그대로 남는다', async () => {
        render(
            <MemoryRouter initialEntries={['/']}>
                <LightApp />
            </MemoryRouter>,
        );

        // 배너가 경계를 붙잡고 있어도 본문은 살아 있어야 한다
        expect(await screen.findByTestId('landing')).toBeInTheDocument();
        expect(screen.getByText('랜딩 본문')).toBeVisible();
    });

    it('배너가 로딩 중이라고 전체 화면 스피너를 띄우지 않는다', async () => {
        render(
            <MemoryRouter initialEntries={['/']}>
                <LightApp />
            </MemoryRouter>,
        );

        await screen.findByTestId('landing');
        // 라우트 전환용 자리표시자는 라우트가 대기할 때만 나온다
        expect(screen.queryByRole('status', { name: '페이지를 불러오는 중' })).not.toBeInTheDocument();
    });
});
