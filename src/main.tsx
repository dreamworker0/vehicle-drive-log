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

/**
 * 엔트리 번들을 못 받았을 때의 마지막 방어선.
 *
 * 엔트리 로드가 실패하면 **React가 아예 마운트되지 않으므로 ErrorBoundary가 낄 자리가 없다.**
 * catch가 없던 동안에는 위 "로딩 중..." 화면이 그대로 남아, 회선이 불안정한 환경의
 * 사용자에게는 앱이 죽은 것처럼 보였다(랜딩 청크를 2회 연속 실패시켜 실측).
 * React 없이 그릴 수 있어야 하므로 로딩 화면과 같은 방식으로 직접 마크업을 넣는다.
 */
function showBootError(err: unknown) {
    console.error('앱 로드 실패:', err);
    root.innerHTML = `
  <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#4f46e5 0%,#3730a3 100%);padding:24px">
    <div style="text-align:center;font-family:system-ui,sans-serif;max-width:320px">
      <p style="color:#fff;font-size:16px;font-weight:600;margin:0 0 8px">앱을 불러오지 못했습니다</p>
      <p style="color:rgba(255,255,255,.75);font-size:14px;line-height:1.6;margin:0 0 20px">
        네트워크 상태를 확인한 뒤 다시 시도해 주세요.
      </p>
      <button id="boot-retry" style="min-height:48px;padding:0 24px;border:0;border-radius:12px;background:#fff;color:#3730a3;font-size:14px;font-weight:600;cursor:pointer">
        다시 시도
      </button>
    </div>
  </div>
`;
    document.getElementById('boot-retry')?.addEventListener('click', () => window.location.reload());
}

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
// 비인증 사용자는 이 프리로드를 await하지 않으므로, 실패해도 unhandledrejection이
// 뜨지 않게 여기서 한 번 받아 둔다. 원본 프라미스는 그대로라 아래 await는 정상적으로 던진다.
appEntryPreload.catch(() => { /* 인증 경로의 await에서 처리한다 */ });
// persistence 설정 완료를 기다린 뒤 Auth 상태 확인
authReady.then(() => {
    // 에뮬레이터(E2E) 모드: 항상 전체 앱을 로드한다.
    // 경량 entry(lightEntry)에는 AuthProvider와 __E2E_AUTH__ 로그인 헬퍼가 없어
    // 테스트에서 로그인 후 리다이렉트가 동작하지 않으므로, 전체 앱으로 고정한다.
    if (import.meta.env.VITE_USE_EMULATOR === 'true') {
        appEntryPreload.then(({ renderFullApp }) => renderFullApp()).catch(showBootError);
        return;
    }
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
        unsubscribe();

        try {
            if (user && !user.isAnonymous) {
                // 인증 사용자 → 전체 앱 로드 (프리로드된 번들 즉시 사용)
                const { renderFullApp } = await appEntryPreload;
                renderFullApp();
            } else {
                // 비인증 사용자 → 경량 앱 로드
                const { renderLightApp } = await import('./lightEntry');
                renderLightApp();
            }
        } catch (err) {
            // 청크를 못 받으면 여기서 잡지 않는 한 "로딩 중..." 화면이 영원히 남는다
            showBootError(err);
        }
    });
}).catch(showBootError);
