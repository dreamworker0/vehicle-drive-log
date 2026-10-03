/**
 * 기관 관리자가 마지막으로 쓴 화면(관리자 / 직원)을 기억한다.
 *
 * 기관 관리자는 [직원 화면]으로 넘어가 본인 운행을 기록하는 일이 많다. 그런데 앱을 다시 열면
 * 시작 주소(`/`)에서 역할만 보고 항상 관리자 화면으로 보냈다 — 폰 PWA에서 운행을 기록하고
 * 나중에 다시 열 때마다 직원 화면으로 다시 넘어가야 했다(2026-10-03 사용자 요청).
 *
 * - **localStorage**: 앱을 껐다 켜도 남아야 하므로 sessionStorage가 아니다.
 *   (슈퍼관리자 테스트 모드 `SA_TEST_ROLE_KEY`는 탭마다 독립이어야 해서 sessionStorage다 — 용도가 다르다.)
 * - **계정별(uid)**: 한 기기를 여러 사람이 쓰면 다른 계정이 남의 선택을 물려받지 않게 한다.
 * - **화면 종류만** 기억한다. 세부 페이지(작성 중이던 폼 등)까지 되살리면 오래된 입력 화면에
 *   떨어질 수 있어 각 화면의 첫 페이지로 보낸다.
 */

export type AdminArea = 'admin' | 'employee';

const LAST_AREA_KEY = 'admin-last-area';

/** 기관 관리자가 지금 보고 있는 화면 종류를 기록한다. */
export function rememberAdminArea(uid: string | null | undefined, area: AdminArea): void {
    if (!uid) return;
    try {
        localStorage.setItem(LAST_AREA_KEY, JSON.stringify({ uid, area }));
    } catch { /* 스토리지를 못 쓰는 환경(사파리 프라이빗 등)은 기본값(관리자 화면)으로 동작 */ }
}

/** 기관 관리자의 시작 화면 경로 — 마지막에 직원 화면을 썼으면 `/employee`, 아니면 `/admin`. */
export function adminHomePath(uid: string | null | undefined): '/admin' | '/employee' {
    if (!uid) return '/admin';
    try {
        const raw = localStorage.getItem(LAST_AREA_KEY);
        if (!raw) return '/admin';
        const saved = JSON.parse(raw) as { uid?: unknown; area?: unknown };
        return saved.uid === uid && saved.area === 'employee' ? '/employee' : '/admin';
    } catch {
        return '/admin';
    }
}
