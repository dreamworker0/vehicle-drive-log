/**
 * inviteCodeCapture — 초대 링크의 `?code=`를 로그인 뒤까지 보관한다
 *
 * ## 왜 main.tsx에서 부르는가
 * 예전에는 이 일을 App.tsx(전체 앱)의 effect만 했다. 그런데 **로그인하지 않은 사람은 전체 앱이
 * 아니라 경량 화면(lightEntry → LightApp)으로 시작**한다. 초대 링크를 처음 연 직원은 랜딩에서
 * [로그인]을 누르는 순간 `/login`으로 이동하며 `?code=`가 떨어졌고, 전체 앱은 로그인 뒤에야
 * 떠서 이미 코드가 없는 주소를 봤다 — 초대 코드 화면이 빈 칸으로 떴다(2026-10-14 동산 사회복지관
 * 신규 가입에서 발견, 경량 화면이 생긴 2026-03부터 처음 로그인하는 직원은 모두 같은 일을 겪었다).
 * 한 번 로그인한 브라우저는 전체 앱으로 바로 시작해 문제가 드러나지 않았다.
 *
 * 어느 화면으로 시작하든 지나가는 부팅 첫 지점(main.tsx)에서 한 번 보관한다.
 * App.tsx도 같은 함수를 불러 다른 경로로 들어온 코드까지 받는다(두 번 불려도 안전하다).
 *
 * localStorage인 이유: Google 로그인 리다이렉트가 도메인을 오가는 동안 sessionStorage는 사라진다.
 * 가입이 성공할 때까지 지우지 않는다(InviteCodePage가 지운다).
 */
export const PENDING_INVITE_CODE_KEY = 'pendingInviteCode';

export function captureInviteCodeFromUrl(): void {
    try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        if (!code) return;
        localStorage.setItem(PENDING_INVITE_CODE_KEY, code.toUpperCase());
        // 주소창에서 코드를 지운다 — 공유·북마크로 다른 사람에게 옮겨 가지 않게.
        params.delete('code');
        const query = params.toString();
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    } catch {
        // 저장소가 막힌 환경(시크릿 모드 일부 등) — 사용자가 코드를 직접 입력하면 된다
    }
}
