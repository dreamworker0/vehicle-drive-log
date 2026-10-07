/**
 * 업데이트 소식 — 주제별 묶기 · 굵은 글씨 조각 · 공용 목록 렌더링
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { groupByArea, splitEmphasis, releaseSignature, hasUnseenRelease, type ReleaseItem, type ReleaseNote } from '../../lib/releaseNotes';
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

describe('새 소식 배지 — releaseSignature · hasUnseenRelease', () => {
    const note = (date: string, texts: string[], title = '제목'): ReleaseNote => ({ date, title, items: texts.map(t => item(t)) });
    const morning = [note('2026-10-01', ['오전 공지']), note('2026-09-24', ['옛 공지'])];
    const afternoon = [note('2026-10-01', ['오전 공지', '오후 공지']), note('2026-09-24', ['옛 공지'])];

    it('같은 날 공지를 덧붙이면 배지가 다시 뜬다 — 예전 서명(날짜 항목 수)은 그대로라 안 떴다', () => {
        const seen = releaseSignature(morning)!;
        expect(hasUnseenRelease(seen, releaseSignature(afternoon)!)).toBe(true);
    });

    it('같은 날 공지를 다시 써도(제목·주제 포함) 배지가 뜬다', () => {
        const seen = releaseSignature(morning)!;
        expect(hasUnseenRelease(seen, releaseSignature([note('2026-10-01', ['오전 공지'], '새 제목'), morning[1]])!)).toBe(true);
    });

    it('본 그대로면 배지가 없고, 더 새 날짜면 뜬다', () => {
        const sig = releaseSignature(morning)!;
        expect(hasUnseenRelease(sig, sig)).toBe(false);
        expect(hasUnseenRelease(sig, releaseSignature([note('2026-10-02', ['다음 날']), ...morning])!)).toBe(true);
    });

    it('이전 배포로 되돌려 날짜가 더 옛것이면 다시 띄우지 않는다', () => {
        const seen = releaseSignature([note('2026-10-02', ['다음 날']), ...morning])!;
        expect(hasUnseenRelease(seen, releaseSignature(morning)!)).toBe(false);
    });

    it('처음 보는 사람과 예전 형식으로 저장된 값', () => {
        const sig = releaseSignature(morning)!;
        expect(hasUnseenRelease(null, sig)).toBe(true);
        expect(hasUnseenRelease('2026-09-24#0113', sig)).toBe(true); // 예전 형식, 날짜가 옛것
        expect(hasUnseenRelease('2026-10-01#0114', sig)).toBe(true); // 예전 형식, 같은 날 — 한 번 더 뜬다(놓치는 것보다 낫다)
        expect(hasUnseenRelease('2026-10-01', sig)).toBe(true);
    });

    it('공지가 없으면 서명도 없다', () => {
        expect(releaseSignature([])).toBeNull();
    });
});
