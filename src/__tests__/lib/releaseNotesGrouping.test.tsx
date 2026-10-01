/**
 * 업데이트 소식 — 주제별 묶기 · 굵은 글씨 조각 · 공용 목록 렌더링
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { groupByArea, splitEmphasis, type ReleaseItem } from '../../lib/releaseNotes';
import ReleaseNoteItems from '../../components/common/ReleaseNoteItems';

const item = (text: string, area?: string, type: ReleaseItem['type'] = 'improved'): ReleaseItem => ({ type, text, ...(area ? { area } : {}) });

describe('groupByArea', () => {
    it('처음 나온 주제 순서대로 묶고, 항목 순서는 지킨다', () => {
        const groups = groupByArea([item('a', '🚀 바로 운행'), item('b', '📊 통계'), item('c', '🚀 바로 운행')]);
        expect(groups.map(g => [g.area, g.items.map(i => i.text)])).toEqual([
            ['🚀 바로 운행', ['a', 'c']],
            ['📊 통계', ['b']],
        ]);
    });

    it('주제가 없는 옛 공지는 소제목 없는 묶음 하나 — 예전 화면과 같다', () => {
        expect(groupByArea([item('a'), item('b')])).toEqual([{ area: null, items: [item('a'), item('b')] }]);
    });

    it('빈 주제·공백 주제는 주제 없음으로 본다', () => {
        expect(groupByArea([item('a', '  '), item('b')]).map(g => g.area)).toEqual([null]);
    });
});

describe('splitEmphasis', () => {
    it('**강조**를 굵은 조각으로 나눈다', () => {
        expect(splitEmphasis("첫 화면에 **'바로 운행'** 을 크게, **둘째**도")).toEqual([
            { text: '첫 화면에 ', strong: false },
            { text: "'바로 운행'", strong: true },
            { text: ' 을 크게, ', strong: false },
            { text: '둘째', strong: true },
            { text: '도', strong: false },
        ]);
    });

    it('강조가 없으면 통째로, 짝이 안 맞는 **는 글자 그대로', () => {
        expect(splitEmphasis('그냥 글')).toEqual([{ text: '그냥 글', strong: false }]);
        expect(splitEmphasis('a ** b')).toEqual([{ text: 'a ** b', strong: false }]);
    });
});

describe('ReleaseNoteItems', () => {
    it('주제 소제목과 건수를 보이고, 별표 대신 굵은 글씨로 그린다', () => {
        const { container } = render(<ReleaseNoteItems items={[
            item('**바로 운행** 을 크게', '🚀 바로 운행'),
            item('숫자를 고쳤어요', '📊 통계 · 분석', 'fixed'),
            item('하나 더', '🚀 바로 운행', 'new'),
        ]} />);

        const headings = screen.getAllByRole('heading', { level: 4 }).map(h => h.textContent);
        expect(headings).toEqual(['🚀 바로 운행 · 2', '📊 통계 · 분석 · 1']);
        expect(screen.getByText('바로 운행').tagName).toBe('STRONG');
        expect(container.textContent).not.toContain('**');
        expect(screen.getByText(/수정/)).toBeTruthy();
    });

    it('주제가 없으면 소제목을 그리지 않는다', () => {
        render(<ReleaseNoteItems items={[item('옛 공지')]} />);
        expect(screen.queryByRole('heading')).toBeNull();
        expect(screen.getByText('옛 공지')).toBeTruthy();
    });

    it('본문의 태그처럼 보이는 글자는 태그로 해석하지 않는다', () => {
        const { container } = render(<ReleaseNoteItems items={[item('<img src=x onerror=alert(1)> **굵게**')]} />);
        expect(container.querySelector('img')).toBeNull();
        expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    });
});
