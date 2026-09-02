// 서비스 워커 강제 퍼지 (PURGE_VER을 바꾸면 재실행)
(function () {
    var PURGE_KEY = 'sw_purge_v';
    var PURGE_VER = '4';
    if (localStorage.getItem(PURGE_KEY) === PURGE_VER) return;
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function (regs) {
            regs.forEach(function (r) { r.unregister(); });
        });
    }
    if ('caches' in window) {
        caches.keys().then(function (names) {
            names.forEach(function (n) { caches.delete(n); });
        });
    }
    // IndexedDB 선별 삭제 — Firestore/Firebase 오프라인 캐시는 보존
    if (indexedDB && indexedDB.databases) {
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
    localStorage.setItem(PURGE_KEY, PURGE_VER);
    setTimeout(function () { location.reload(); }, 1000);
})();
