// 서비스 워커 강제 퍼지 (PURGE_VER을 바꾸면 재실행)
//
// 지울 워커·캐시가 **실제로 있을 때만** 지우고 새로고침한다.
// 예전에는 표식(sw_purge_v)이 없으면 무조건 1초 뒤 location.reload()를 불렀다. 그런데 표식이
// 없는 브라우저의 대부분은 퍼지 대상(옛 워커가 붙은 기존 사용자)이 아니라 **처음 들어온
// 방문자**다 — 지울 것이 하나도 없는데도 첫 화면이 뜬 직후 한 번 더 통째로 다시 불렸다
// (입력 중이던 글자·스크롤이 날아가고, E2E는 새 브라우저마다 이 새로고침과 경주했다).
// 워커·캐시가 없는 브라우저는 옛 셸에 묶여 있을 수 없으므로 표식만 남기고 끝낸다.
(function () {
    var PURGE_KEY = 'sw_purge_v';
    var PURGE_VER = '4';
    if (localStorage.getItem(PURGE_KEY) === PURGE_VER) return;
    localStorage.setItem(PURGE_KEY, PURGE_VER);

    // 조회가 실패하면(사파리 사생활 보호 모드 등) 있는지 알 수 없다 — 예전처럼 퍼지 쪽으로 간다.
    function listOrUnknown(promise) {
        return promise.then(null, function () { return null; });
    }
    var regsP = 'serviceWorker' in navigator
        ? listOrUnknown(navigator.serviceWorker.getRegistrations())
        : Promise.resolve([]);
    var cachesP = 'caches' in window
        ? listOrUnknown(caches.keys())
        : Promise.resolve([]);

    Promise.all([regsP, cachesP]).then(function (found) {
        var regs = found[0];
        var names = found[1];
        if (regs && names && regs.length === 0 && names.length === 0) return;

        if (regs) regs.forEach(function (r) { r.unregister(); });
        if (names) names.forEach(function (n) { caches.delete(n); });
        // IndexedDB 선별 삭제 — Firestore/Firebase 오프라인 캐시는 보존
        if (window.indexedDB && indexedDB.databases) {
            indexedDB.databases().then(function (dbs) {
                dbs.forEach(function (d) {
                    if (d.name &&
                        d.name.indexOf('firestore') === -1 &&
                        d.name.indexOf('firebase') === -1 &&
                        // 오프라인 쓰기 큐(src/lib/offline/syncQueue.ts) — 지하 주차장에서 쓴 미전송 기록이 담겨 있다.
                        // 이름에 firebase가 없어 종전에는 PURGE_VER를 올릴 때마다 함께 지워졌다 (2026-09-02).
                        d.name !== 'sync-db') {
                        indexedDB.deleteDatabase(d.name);
                    }
                });
            });
        }
        setTimeout(function () { location.reload(); }, 1000);
    });
})();
