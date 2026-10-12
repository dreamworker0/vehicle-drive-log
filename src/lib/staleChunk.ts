/**
 * 배포 직후 구버전 탭이 사라진 해시 청크를 불러오다 실패한 경우를 가려낸다.
 *
 * 화면 전환(`lazyWithRetry`)은 한 번 새로고침해 스스로 복구하지만, 엑셀·PDF 내보내기처럼
 * **버튼을 누를 때 `await import()`로 불러오는 모듈**은 그 장치를 거치지 않는다. 실패하면
 * 각 화면의 catch가 브라우저 원문("Failed to fetch dynamically imported module: …")을
 * 그대로 토스트로 띄웠고, 실무자는 이를 장애로 받아들였다(2026-10-12 기관 문의).
 *
 * 자동 새로고침은 하지 않는다 — 기간·필터가 초기화된 채 다시 내려받거나, 작성 중인 폼이
 * 날아갈 수 있다. 대신 안내 문구와 [새로고침] 버튼을 띄운다.
 * - 토스트 스토어(`useToastStore.showToast`)가 오류 원문이나 `STALE_CHUNK_MESSAGE`를 받으면
 *   안내 문구 + [새로고침] 버튼으로 바꾸고, 이미 떠 있으면 겹쳐 띄우지 않는다.
 * - 원문 대신 고정 문구를 띄우던 catch(`useAdminLogExport` 등)는 이 함수로 가려
 *   `STALE_CHUNK_MESSAGE`를 넘긴다.
 *
 * 패턴은 브라우저별 원문이다. Sentry `ignoreErrors`의 청크 항목과 같은 범위를 본다.
 */
const STALE_CHUNK_PATTERNS: RegExp[] = [
    /Failed to fetch dynamically imported module/i, // Chrome·Edge
    /error loading dynamically imported module/i, // Firefox
    /Importing a module script failed/i, // Safari
    /is not a valid JavaScript MIME type/i, // 404 대신 index.html이 돌아온 경우
    /Unable to preload CSS for/i, // Vite 프리로드 헬퍼
    /ChunkLoadError/,
    /Loading chunk .* failed/i,
];

export const STALE_CHUNK_MESSAGE = '앱이 새 버전으로 업데이트되었어요. 새로고침한 뒤 다시 시도해 주세요.';

export function isStaleChunkError(value: unknown): boolean {
    const text = value instanceof Error ? `${value.name}: ${value.message}` : typeof value === 'string' ? value : '';
    if (!text) return false;
    return STALE_CHUNK_PATTERNS.some((re) => re.test(text));
}
