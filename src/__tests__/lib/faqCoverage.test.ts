import { describe, it, expect } from 'vitest';
import notesJson from '../../../public/data/releaseNotes.json';
import { FAQ_ITEMS } from '@/lib/faqData';
import {
    FAQ_COVERAGE_SINCE, requiresFaqLink, findMissingLinks, findDanglingLinks, findMalformedLinks,
    type ReleaseNoteEntry,
} from '../../../scripts/lib/faqCoverageRules';

/**
 * FAQ 누락 게이트의 판정 규칙.
 *
 * 실물(releaseNotes.json + FAQ_ITEMS)도 함께 검사한다 — CLI가 CI에서 돌지만, 여기서 깨지면
 * 커밋 훅 단계에서 먼저 걸려 왕복이 줄어든다. import 경로가 상대경로인 이유는 프론트
 * tsconfig에 scripts 별칭이 없어서다(releaseNotesData.test.ts와 같은 사정).
 */
const notes = notesJson as ReleaseNoteEntry[];

describe('requiresFaqLink', () => {
    it('기준일 이후의 새 기능만 연결을 요구한다', () => {
        expect(requiresFaqLink({ type: 'new', text: 'x' }, '2026-09-10', '2026-09-04')).toBe(true);
    });

    it('수정·개선은 요구하지 않는다 — 대개 설명할 것이 없다', () => {
        expect(requiresFaqLink({ type: 'fixed', text: 'x' }, '2026-09-10', '2026-09-04')).toBe(false);
        expect(requiresFaqLink({ type: 'improved', text: 'x' }, '2026-09-10', '2026-09-04')).toBe(false);
    });

    it('기준일 이전 공지는 요구하지 않는다 — 소급해 채운 연결은 추측이 된다', () => {
        expect(requiresFaqLink({ type: 'new', text: 'x' }, '2026-08-01', '2026-09-04')).toBe(false);
    });

    it('기준일 **당일**은 포함한다', () => {
        // 경계가 없으면 >= 를 > 로 바꿔도 아무 테스트가 깨지지 않는다. 그러면 이 PR이
        // 연결을 채워 넣은 2026-09-04 공지가 조용히 대상에서 빠진다.
        expect(requiresFaqLink({ type: 'new', text: 'x' }, '2026-09-04', '2026-09-04')).toBe(true);
        expect(requiresFaqLink({ type: 'new', text: 'x' }, '2026-09-03', '2026-09-04')).toBe(false);
    });
});

describe('findMissingLinks', () => {
    it('연결을 적지 않은 새 기능을 집어낸다', () => {
        const gaps = findMissingLinks([
            { date: '2026-09-10', title: 'T', items: [{ type: 'new', text: '설명 없음' }] },
        ], '2026-09-04');
        expect(gaps).toHaveLength(1);
        expect(gaps[0].text).toBe('설명 없음');
    });

    it('빈 배열은 "필요 없다고 판단함"으로 받아들인다 — 기계는 필요 여부를 판단하지 않는다', () => {
        expect(findMissingLinks([
            { date: '2026-09-10', title: 'T', items: [{ type: 'new', text: 'x', faq: [] }] },
        ], '2026-09-04')).toEqual([]);
    });
});

describe('findDanglingLinks', () => {
    it('없는 FAQ를 가리키는 연결을 집어낸다 — 이름이 바뀌면 조용히 끊긴다', () => {
        const dangling = findDanglingLinks([
            { date: '2026-09-10', title: 'T', items: [{ type: 'new', text: 'x', faq: ['gone-id'] }] },
        ], ['real-id']);
        expect(dangling).toHaveLength(1);
        expect(dangling[0].faqId).toBe('gone-id');
    });

    it('날짜와 무관하게 본다 — 기준일 이전 공지의 연결도 끊기면 잡는다', () => {
        expect(findDanglingLinks([
            { date: '2020-01-01', title: 'T', items: [{ type: 'new', text: 'x', faq: ['gone'] }] },
        ], ['real'])).toHaveLength(1);
    });
});

describe('findMalformedLinks', () => {
    it('배열이 아닌 faq를 집어낸다 — 두 검사 모두 조용히 빠져나가는 유일한 구멍이다', () => {
        // 문자열 하나를 적는 실수가 가장 흔한데, findMissingLinks는 new가 아니면 건너뛰고
        // findDanglingLinks는 배열이 아니면 건너뛴다. 오타 난 id가 적혀 있어도 ✅가 찍힌다.
        const bad = findMalformedLinks([
            { date: '2026-09-10', title: 'T', items: [{ type: 'improved', text: 'x', faq: 'typo-id' }] },
        ]);
        expect(bad).toHaveLength(1);
        expect(bad[0].value).toBe('typo-id');
    });

    it('없거나 배열이면 문제 삼지 않는다', () => {
        expect(findMalformedLinks([
            { date: '2026-09-10', title: 'T', items: [{ type: 'new', text: 'x' }, { type: 'new', text: 'y', faq: [] }] },
        ])).toEqual([]);
    });
});

describe('실물 공지·FAQ', () => {
    it(`${FAQ_COVERAGE_SINCE} 이후 새 기능에 FAQ 연결이 모두 적혀 있다`, () => {
        expect(findMissingLinks(notes).map(g => `${g.date} ${g.title}`)).toEqual([]);
    });

    it('끊긴 연결이 없다', () => {
        const ids = FAQ_ITEMS.map(item => item.id);
        expect(findDanglingLinks(notes, ids).map(l => l.faqId)).toEqual([]);
    });

    it('모양이 잘못된 연결이 없다', () => {
        expect(findMalformedLinks(notes).map(b => `${b.date} ${JSON.stringify(b.value)}`)).toEqual([]);
    });
});
