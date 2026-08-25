/**
 * RouteInfoPanel — 좁은 화면·큰 글씨에서 경로 정보 줄이 깨지지 않는지 확인한다.
 *
 * "🚩 본관 출발 · 고속 · 161km · 152분 · ₩8,400"이 한 줄에 다 들어가지 않으면
 * flex가 각 항목을 content 아래로 눌러 글자가 한 자씩 세로로 쪼개졌다(제보 스크린샷).
 * jsdom은 레이아웃을 계산하지 못하므로, 줄바꿈을 허용하고 각 값을 nowrap으로 묶는
 * 규칙이 되돌아가지 않게 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RouteInfoPanel from '../../components/common/reservation/RouteInfoPanel';

const routeInfo = { distance: 161.4, duration: 152, tollFee: 8400, hasToll: true };

describe('RouteInfoPanel (경로 정보 줄)', () => {
    it('항목이 많으면 줄을 바꾼다 (한 줄에 밀어 넣지 않는다)', () => {
        render(
            <RouteInfoPanel routeInfo={routeInfo} routeLoading={false} departureSiteName="본관" />
        );

        const row = screen.getByText(/161km/).parentElement!;
        expect(row.className).toContain('flex-wrap');
    });

    it('거리·시간·통행료는 중간에서 끊기지 않는다', () => {
        render(
            <RouteInfoPanel routeInfo={routeInfo} routeLoading={false} departureSiteName="본관" />
        );

        for (const text of [/161km/, /152분/, /₩8,400/, /고속/]) {
            expect(screen.getByText(text).className).toContain('whitespace-nowrap');
        }
    });

    it('출발지 이름이 길면 쪼개지 않고 말줄임한다', () => {
        render(
            <RouteInfoPanel
                routeInfo={routeInfo}
                routeLoading={false}
                departureSiteName="아주아주 긴 이름의 제2별관 종합사회복지관"
            />
        );

        const badge = screen.getByText(/제2별관 종합사회복지관 출발/);
        expect(badge.className).toContain('truncate');
        expect(badge.className).toContain('max-w-full');
    });
});
