/**
 * manualSections — 사용 설명서 콘텐츠 데이터 (Lazy Loader)
 *
 * 정적 데이터를 public/data/manualSections.json에서 비동기 로드하여
 * 메인 번들 크기를 ~28KB 절감합니다.
 */

export interface ManualContent {
    text: string;
    type?: 'tip' | 'warning' | 'step' | 'link';
    url?: string;
}

export interface ManualSection {
    title: string;
    content: ManualContent[];
}

interface ManualData {
    adminSections: ManualSection[];
    employeeSections: ManualSection[];
}

let _cache: ManualData | null = null;

const EMPTY_DATA: ManualData = { adminSections: [], employeeSections: [] };

/**
 * 매뉴얼 섹션 데이터를 비동기로 로드합니다.
 * 한 번 로드된 데이터는 메모리에 캐싱됩니다.
 */
export async function loadManualSections(): Promise<ManualData> {
    if (_cache) return _cache;

    try {
        const res = await fetch('/data/manualSections.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        _cache = (await res.json()) as ManualData;
        return _cache;
    } catch (err) {
        console.error('[manualSections] 데이터 로드 실패:', err);
        return EMPTY_DATA;
    }
}
