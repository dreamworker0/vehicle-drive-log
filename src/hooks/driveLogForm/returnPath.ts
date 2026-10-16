/**
 * 수정 후 돌아갈 경로를 믿어도 되는가 — 화면 이동 상태(location.state)로 들어온 값이라 그대로 쓰지 않는다.
 *
 * 앱 안 관리자 화면 경로만 받는다. `//host`(프로토콜 상대 URL)나 외부 주소, 직원 화면을 돌아가는
 * 경로로 쓰면 열린 리디렉트이거나 의미 없는 왕복이 된다.
 */
export function safeAdminReturnPath(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    if (!raw.startsWith('/admin') || raw.startsWith('//')) return null;
    if (/[\\\s]/.test(raw)) return null;
    return raw;
}
