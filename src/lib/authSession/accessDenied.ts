/**
 * 사용자·기관 문서 구독이 `permission-denied`로 막혔을 때의 안내·보고.
 */
import { getAppCheckBlock } from '../firebase';
import { captureError } from '../sentry';
import { useToastStore } from '../../store/useToastStore';

/** App Check 차단으로 인한 접근 실패는 세션당 1회만 보고한다 — 원인이 하나라 반복 보고는 노이즈다. */
let appCheckDenialReported = false;

/**
 * `permission-denied`를 알릴 때 App Check 차단 여부로 문구를 가른다.
 *
 * 두 경우는 **사용자가 할 수 있는 조치가 완전히 다르다.** 권한 문제는 관리자 문의가 답이고,
 * App Check 차단은 SDK가 최대 24시간 스로틀에 들어간 상태라 **새로고침으로 풀리지 않는다.**
 * 그런데 기존 문구는 "페이지 새로고침 요망"이라, 차단된 사용자는 하루 종일 새로고침만
 * 반복하다 포기하게 된다(2026-09-01 Firefox 모바일 사례).
 */
export function notifyAccessDenied(scope: 'org' | 'user', fallbackMessage: string, level: 'warning' | 'error'): void {
    const block = getAppCheckBlock();
    if (!block) {
        useToastStore.getState().showToast(fallbackMessage, level);
        return;
    }

    useToastStore.getState().showToast(
        '보안 인증(App Check)이 차단되어 데이터를 불러올 수 없습니다. 새로고침으로는 해결되지 않으니 잠시 후 다시 시도하거나 다른 브라우저를 이용해 주세요.',
        'error',
        8000,
    );

    if (appCheckDenialReported) return;
    appCheckDenialReported = true;
    // App Check 경고 자체는 노이즈라서 sentry.ts·firebase.ts에서 걸러진다. 그래서 **실제로
    // 피해가 난 순간**만 남긴다 — 이게 없으면 몇 명이 겪는지 알 수 없다(지금까지는 downstream
    // 401 한 건으로 추정해 왔다).
    captureError(new Error('[AppCheck] 보안 인증 차단으로 데이터 접근 실패'), {
        appCheckCode: block.code,
        blockedForMs: Date.now() - block.at,
        scope,
    });
}
