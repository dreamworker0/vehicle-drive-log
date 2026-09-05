import { describe, it, expect } from 'vitest';
import notesJson from '../../../public/data/releaseNotes.json';
import type { ReleaseNote, ReleaseItem } from '@/lib/releaseNotes';

/**
 * releaseNotes.json 데이터 계약 검증.
 *
 * 이 파일은 번들에 넣지 않고 런타임에 fetch하므로 **tsc가 검사하지 못한다.**
 * 그런데 렌더러 두 곳(ReleaseNotesModal, ReleaseNotesPage)은 `TYPE_CONFIG[item.type]`을
 * 폴백 없이 참조해 곧바로 `cfg.color`를 읽는다. 그래서 type이 하나만 틀려도
 * 업데이트 소식 화면이 통째로 크래시한다 — 관리자 화면은 모달이 라우트 ErrorBoundary
 * 바깥에 있어 예외가 루트까지 올라가 화면 전체가 폴백이 된다.
 *
 * 실제로 `"fix"`(→ `"fixed"`) 한 글자 때문에 프로덕션에서 났던 사고다(2026-09-05).
 * 사람이 손으로 쓰는 데이터 파일이라 같은 실수가 또 난다고 보고 게이트를 둔다.
 */

const VALID_TYPES: ReadonlyArray<ReleaseItem['type']> = ['new', 'improved', 'fixed'];

// 런타임(fetch)과 같은 파일을 그대로 읽어 검사한다.
const notes = notesJson as ReleaseNote[];

describe('releaseNotes.json 데이터 계약', () => {
    it('비어 있지 않다', () => {
        expect(Array.isArray(notes)).toBe(true);
        expect(notes.length).toBeGreaterThan(0);
    });

    it('모든 항목의 type이 렌더러가 아는 값이다', () => {
        // 어느 날짜의 어느 항목인지 한눈에 보이도록 전부 모아서 한 번에 단언한다.
        const invalid = notes.flatMap(note =>
            note.items
                .filter(item => !VALID_TYPES.includes(item.type))
                .map(item => `${note.date}: ${JSON.stringify(item.type)}`),
        );
        expect(invalid).toEqual([]);
    });

    it('모든 항목에 읽을 수 있는 text가 있다', () => {
        const empty = notes.flatMap(note =>
            note.items
                .filter(item => typeof item.text !== 'string' || item.text.trim() === '')
                .map(() => note.date),
        );
        expect(empty).toEqual([]);
    });

    it('날짜가 YYYY-MM-DD이고 최신순으로 정렬돼 있다', () => {
        // 배지(useReleaseNotesStatus)와 모달의 최근 N일 창이 날짜 문자열 비교에 기대므로
        // 형식이 어긋나면 새 소식이 안 뜨거나 이미 읽은 소식이 다시 뜬다.
        const malformed = notes.map(n => n.date).filter(d => !/^\d{4}-\d{2}-\d{2}$/.test(d));
        expect(malformed).toEqual([]);

        const dates = notes.map(n => n.date);
        expect(dates).toEqual([...dates].sort().reverse());
    });
});
