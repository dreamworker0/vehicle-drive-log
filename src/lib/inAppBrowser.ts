/**
 * 인앱 브라우저 감지 및 외부 브라우저 전환 유틸리티.
 *
 * 카카오톡, 네이버, LINE, Facebook, Instagram 등
 * 주요 인앱 브라우저에서 Google OAuth가 차단되는 문제를 우회한다.
 */

/**
 * 현재 브라우저가 인앱 브라우저(WebView)인지 감지한다.
 * @returns {boolean} 인앱 브라우저이면 true
 */
export function isInAppBrowser() {
    const ua = navigator.userAgent || navigator.vendor || '';
    // 주요 인앱 브라우저 키워드
    return /KAKAOTALK|NAVER|Line\/|FBAN|FBAV|Instagram|Snapchat|Twitter|MicroMessenger/i.test(ua);
}

/**
 * 현재 페이지를 외부 브라우저(Chrome / Safari)에서 연다.
 * @param {string} [url] - 열 URL. 기본값은 현재 페이지 URL.
 */
export function openInExternalBrowser(url?: string) {
    const target = url || window.location.href;
    const ua = navigator.userAgent || '';
    const encoded = encodeURIComponent(target);

    // 카카오톡: 전용 딥링크로 외부 브라우저 전환 (iOS/Android 공통)
    if (/KAKAOTALK/i.test(ua)) {
        window.location.href = 'kakaotalk://web/openExternal?url=' + encoded;
        return;
    }

    // 네이버: 전용 딥링크로 외부 브라우저 전환 (iOS/Android 공통)
    if (/NAVER/i.test(ua)) {
        window.location.href =
            'naversearchapp://inappbrowser?url=' + encoded + '&target=externalBrowser';
        return;
    }

    if (/android/i.test(ua)) {
        // Android 기타 인앱: Chrome Intent 스킴으로 전환
        const intentUrl =
            `intent://${target.replace(/^https?:\/\//, '')}` +
            `#Intent;scheme=https;package=com.android.chrome;end`;
        window.location.href = intentUrl;
    } else {
        // iOS 기타 인앱 / 기타: 새 창/탭으로 시도
        window.open(target, '_blank');
    }
}

/**
 * 현재 URL을 클립보드에 복사한다.
 * @param {string} [url] - 복사할 URL. 기본값은 현재 페이지 URL.
 * @returns {Promise<boolean>} 복사 성공 여부
 */
export async function copyUrlToClipboard(url?: string) {
    const target = url || window.location.href;
    try {
        await navigator.clipboard.writeText(target);
        return true;
    } catch {
        // clipboard API 미지원 환경 폴백
        const textarea = document.createElement('textarea');
        textarea.value = target;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            return true;
        } catch {
            return false;
        } finally {
            document.body.removeChild(textarea);
        }
    }
}
