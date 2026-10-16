/**
 * 페이지 이동·새로고침·현재 주소를 `window.location` 대신 이 함수로 한다.
 *
 * 테스트가 이동을 관찰하려고 `window.location`을 다시 정의하면 Vitest `vmThreads` 풀에서는
 * 할 수 없다(`Cannot redefine property: location` — jsdom 창이 곧 전역이다). 이 모듈을
 * `vi.mock`하면 어느 풀에서든 이동을 관찰할 수 있다(vitest.config.js THREADS_ONLY_TESTS 주석).
 * 지금은 테스트가 이동을 확인하는 곳(로그아웃·외부 브라우저 전환·구버전 청크 새로고침)만 옮겼다.
 * 이동을 테스트하는 코드를 새로 쓰면 이 함수를 쓴다.
 *
 * 화면 안 이동은 이 모듈이 아니라 react-router(`useNavigate`)를 쓴다. 여기는 페이지를 통째로
 * 다시 불러오거나 앱 밖(딥링크)으로 나가는 경우만이다.
 */

/** 주소로 이동한다(전체 페이지 이동 또는 딥링크). */
export function navigateTo(href: string): void {
    window.location.href = href;
}

/** 현재 페이지를 다시 불러온다. */
export function reloadPage(): void {
    window.location.reload();
}

/** 현재 페이지 주소(전체 URL). */
export function currentHref(): string {
    return window.location.href;
}
