/**
 * releaseNotes — 사용자용 업데이트 소식 데이터 (Lazy Loader)
 *
 * 정적 데이터를 public/data/releaseNotes.json에서 비동기 로드하여
 * 메인 번들 크기를 ~33KB 절감합니다.
 */

export interface ReleaseItem {
    type: 'new' | 'improved' | 'fixed';
    text: string;
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
