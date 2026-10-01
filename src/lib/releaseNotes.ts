/**
 * releaseNotes — 사용자용 업데이트 소식 데이터 (Lazy Loader)
 *
 * 정적 데이터를 public/data/releaseNotes.json에서 비동기 로드하여
 * 메인 번들 크기를 ~33KB 절감합니다.
 */

export interface ReleaseItem {
    type: 'new' | 'improved' | 'fixed';
    text: string;
    /**
     * 이 기능을 설명하는 FAQ의 id 목록 — 화면에는 쓰지 않는 편집용 메타다.
     * 새 기능 공지가 FAQ 없이 나가는 것을 막는 게이트가 본다(scripts/lib/faqCoverageRules.ts).
     */
    faq?: string[];
    /**
     * 주제 — 같은 날짜 안에서 이 이름의 소제목 아래로 모은다(예: '🚀 바로 운행').
     * 하루에 여러 기능이 바뀌면 순서대로만 쌓여 무엇이 바뀌었는지 알기 어려웠다.
     * 처음 나온 순서대로 묶이므로 JSON에서 보여 줄 순서대로 적는다. 없으면 소제목 없이 보인다.
     */
    area?: string;
}

export interface ReleaseNote {
    date: string;
    title?: string;
    items: ReleaseItem[];
}

let _cache: ReleaseNote[] | null = null;

/**
 * 릴리즈 노트 데이터를 비동기로 로드합니다.
 * 한 번 로드된 데이터는 메모리에 캐싱됩니다.
 */
export async function loadReleaseNotes(): Promise<ReleaseNote[]> {
    if (_cache) return _cache;

    try {
        const res = await fetch('/data/releaseNotes.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        _cache = (await res.json()) as ReleaseNote[];
        return _cache;
    } catch (err) {
        console.error('[releaseNotes] 데이터 로드 실패:', err);
        return [];
    }
}

export interface ReleaseItemGroup {
    /** 소제목 — 주제가 없는 항목들은 null */
    area: string | null;
    items: ReleaseItem[];
}

/**
 * 같은 날짜의 항목을 주제별로 묶는다. 주제는 처음 나온 순서, 항목은 원래 순서를 지킨다.
 * 주제가 없는 옛 공지는 소제목 없는 묶음 하나가 된다(예전 화면과 같다).
 */
export function groupByArea(items: readonly ReleaseItem[]): ReleaseItemGroup[] {
    const groups: ReleaseItemGroup[] = [];
    for (const item of items) {
        const area = item.area?.trim() || null;
        let group = groups.find(g => g.area === area);
        if (!group) {
            group = { area, items: [] };
            groups.push(group);
        }
        group.items.push(item);
    }
    return groups;
}

/**
 * 본문의 `**강조**`를 조각으로 나눈다 — 화면은 strong으로 감싸 굵게 보인다.
 * 예전 화면은 글자를 그대로 찍어 별표가 보였다(2026-09-12부터 26건).
 * HTML로 넣지 않고 글자 조각으로 나누므로 본문에 무엇이 있어도 태그로 해석되지 않는다.
 * 짝이 맞지 않는 `**`는 글자 그대로 둔다.
 */
export function splitEmphasis(text: string): { text: string; strong: boolean }[] {
    const parts: { text: string; strong: boolean }[] = [];
    const re = /\*\*(.+?)\*\*/g;
    let last = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
        if (m.index > last) parts.push({ text: text.slice(last, m.index), strong: false });
        parts.push({ text: m[1], strong: true });
        last = m.index + m[0].length;
    }
    if (last < text.length) parts.push({ text: text.slice(last), strong: false });
    return parts;
}
