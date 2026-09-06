/**
 * FAQ 누락 감지의 **판정 규칙** — 순수 함수만 둔다.
 *
 * 공지 게이트(releaseNotesRules)와 달리 "마지막으로 FAQ를 건드린 커밋 이후"로는 잡을 수 없다.
 * FAQ는 사소한 문구 수정으로도 자주 바뀌어 기준점이 계속 앞으로 밀리기 때문이다. 실제로
 * 출발지·분관 기능은 공지가 네 번(8/18·8/19·8/25·9/4) 나가는 동안 FAQ 항목이 하나도 없었는데,
 * 그 사이 FAQ 파일은 다른 이유로 여러 번 바뀌어 그런 방식으로는 끝까지 감지되지 않았다.
 *
 * 그래서 **연결을 명시하게** 한다. 새 기능 공지(`type: "new"`)에는 그것을 설명하는 FAQ의 id를
 * 적는다. 설명할 FAQ가 필요 없다고 판단했으면 빈 배열(`[]`)을 적는다 — 기계는 "적었는지"만 보고
 * "필요한지"는 판단하지 않는다. 판단은 사람이 하되, **판단을 건너뛰는 것**은 막는다.
 *
 * CLI(`scripts/check-faq-coverage.ts`)와 단위 테스트가 같은 규칙을 쓰도록 분리했다.
 * Node API를 쓰지 않으므로 앱 tsconfig에서도 그대로 타입 검사된다.
 */

/**
 * 이 날짜부터의 공지에만 적용한다.
 *
 * 과거 공지는 101건의 `new` 항목을 담고 있어 소급해 채우는 것은 현실적이지 않고, 지금 와서
 * 채운 연결은 실제로 확인한 것이 아니라 추측이 된다. 앞으로 나가는 것부터 지킨다.
 */
export const FAQ_COVERAGE_SINCE = '2026-09-04';

export interface ReleaseNoteItem {
    type: string;
    text: string;
    /** 이 기능을 설명하는 FAQ의 id 목록. 빈 배열은 "FAQ가 필요 없다고 판단함"을 뜻한다. */
    faq?: string[];
}

export interface ReleaseNoteEntry {
    date: string;
    title: string;
    items: ReleaseNoteItem[];
}

/** 연결을 요구할 항목인가 — 새 기능만. 수정·개선은 대개 설명할 것이 없다. */
export function requiresFaqLink(item: ReleaseNoteItem, date: string, since = FAQ_COVERAGE_SINCE): boolean {
    return item.type === 'new' && date >= since;
}

export interface CoverageGap {
    date: string;
    title: string;
    text: string;
}

/** 연결을 적지 않은 새 기능 공지. */
export function findMissingLinks(
    notes: ReleaseNoteEntry[],
    since = FAQ_COVERAGE_SINCE,
): CoverageGap[] {
    const gaps: CoverageGap[] = [];
    for (const entry of notes) {
        for (const item of entry.items) {
            if (!requiresFaqLink(item, entry.date, since)) continue;
            if (Array.isArray(item.faq)) continue;
            gaps.push({ date: entry.date, title: entry.title, text: item.text });
        }
    }
    return gaps;
}

export interface DanglingLink {
    date: string;
    title: string;
    faqId: string;
}

/**
 * 존재하지 않는 FAQ를 가리키는 연결 — **날짜와 무관하게** 전부 본다.
 *
 * FAQ의 id는 URL 해시 딥링크로도 쓰여서 이름이 바뀌거나 항목이 지워질 수 있다. 그때 공지 쪽
 * 연결이 조용히 끊기면, 이 게이트는 통과하는데 실제로는 아무것도 설명하지 않는 상태가 된다.
 */
export function findDanglingLinks(
    notes: ReleaseNoteEntry[],
    faqIds: Iterable<string>,
): DanglingLink[] {
    const known = new Set(faqIds);
    const dangling: DanglingLink[] = [];
    for (const entry of notes) {
        for (const item of entry.items) {
            if (!Array.isArray(item.faq)) continue;
            for (const faqId of item.faq) {
                if (!known.has(faqId)) dangling.push({ date: entry.date, title: entry.title, faqId });
            }
        }
    }
    return dangling;
}
