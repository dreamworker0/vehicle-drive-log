/**
 * main.tsx — 경량 진입점
 *
 * Firebase Auth 상태만 최소한으로 확인한 뒤, 인증 여부에 따라
 * 서로 다른 엔트리포인트를 동적으로 로드한다.
 *
 * - 인증 사용자: appEntry.tsx  (전체 앱 — AuthProvider, Sentry 등 포함)
 * - 비인증 사용자: lightEntry.tsx (Landing/Login만 — 경량)
 *
 * 이를 통해 비인증 사용자의 초기 번들 크기를 ~300KB 절감하여
 * Lighthouse Performance 점수를 개선한다.
 */
import { onAuthStateChanged } from 'firebase/auth';
import { auth, authReady } from './lib/firebaseAuth';
import './index.css';

// 로딩 표시 (Auth 상태 확인 중)
const root = document.getElementById('root')!;
root.innerHTML = `
  <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#4f46e5 0%,#3730a3 100%)">
    <div style="text-align:center">
      <div style="width:48px;height:48px;border:3px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;margin:0 auto 16px;animation:spin 1s linear infinite"></div>
      <p style="color:rgba(255,255,255,.8);font-family:system-ui,sans-serif;font-size:14px">로딩 중...</p>
    </div>
  </div>
  <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
`;

// 기존 SW가 있으면 즉시 업데이트 체크 (구버전 캐시 방지)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.ready.then((reg) => {
    reg.update().catch(() => { /* 네트워크 에러 무시 */ });
  });
  // 새 SW가 활성화되면 자동 새로고침 (배포 후 즉시 반영)
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });
}

// Auth 상태 확인과 병렬로 appEntry 번들을 미리 로드 (추측적 프리로드)
// 대부분(~80%)의 방문이 재방문(인증 사용자)이므로 높은 적중률 기대
// import()는 최초 한 번만 네트워크 요청을 발생시키고, 이후 호출은 캐시에서 즉시 반환
const appEntryPreload = import('./appEntry');
// persistence 설정 완료를 기다린 뒤 Auth 상태 확인
authReady.then(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
        unsubscribe();

        if (user && !user.isAnonymous) {
            // 인증 사용자 → 전체 앱 로드 (프리로드된 번들 즉시 사용)
            const { renderFullApp } = await appEntryPreload;
            renderFullApp();
        } else {
            // 비인증 사용자 → 경량 앱 로드
            const { renderLightApp } = await import('./lightEntry');
            renderLightApp();
        }
    });
});
