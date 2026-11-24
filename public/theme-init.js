// React 마운트 전 theme-color 초기화 (브라우저 주소창 색이 잠깐 반대 테마로 번쩍이는 것 방지)
//
// 예전에는 index.html의 인라인 <script>였다. 인라인 스크립트 하나 때문에 CSP script-src에
// 'unsafe-inline'을 열어 두어야 했고, 그러면 XSS로 주입된 인라인 스크립트도 그대로 실행된다.
// 외부 파일로 옮겨 'unsafe-inline'을 닫았다(2026-11-24, sw-purge.js와 같은 방식).
//
// ⚠️ index.html에서 defer·async 없이 <head>에 둔다 — 첫 페인트 전에 돌아야 의미가 있다.
// ⚠️ firebase.json이 *.js를 1년 immutable로 서빙하므로 프리캐시(vite.config.js globPatterns)에
//    있어야 고친 내용이 클라이언트에 닿는다.
(function () {
    try {
        var s = localStorage.getItem('theme-preference');
        var d = s === 'dark' || (s !== 'light' && window.matchMedia('(prefers-color-scheme:dark)').matches);
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.content = d ? '#020617' : '#f8fafc';
    } catch {
        // localStorage 차단(사파리 사생활 보호 등) — 기본 색(라이트) 그대로 둔다
    }
})();
