/**
 * 인앱 브라우저 감지 및 외부 브라우저 전환 유틸리티.
 *
 * 카카오톡, 네이버, 밴드, 카카오스토리, 다음, LINE, Facebook, Instagram 등
 * 주요 인앱 브라우저에서 Google OAuth가 차단되는("정책을 준수하지 않습니다",
 * disallowed_useragent) 문제를 우회한다.
 */

/**
 * 현재 브라우저가 인앱 브라우저(WebView)인지 감지한다.
 *
 * 주의: iOS 홈화면 설치 PWA는 UA에 "Safari"가 없으므로 "Safari 미포함 = 인앱" 식
 * 휴리스틱은 우리 설치 사용자를 오탐(차단)한다. 따라서 명시적 키워드와, 오탐 없는
 * Android WebView 토큰("; wv)")만 사용한다. 이름을 모르는 Android 계열 인앱
 * 브라우저 대부분이 "; wv)"를 포함하므로 이 토큰으로 폭넓게 감지된다.
 * @returns {boolean} 인앱 브라우저이면 true
 */
export function isInAppBrowser() {
    const ua = navigator.userAgent || navigator.vendor || '';
    // 주요 인앱 브라우저 키워드 + Android WebView 토큰("; wv)")
    return /KAKAOTALK|kakaostory|NAVER|BAND\/|DaumApps|Line\/|FBAN|FBAV|Instagram|Snapchat|Twitter|MicroMessenger|;\s?wv\)/i.test(ua);
}

/**
 * 현재 인앱 브라우저의 사용자 친화적 이름을 반환한다. 모르면 null.
 * 안내 화면에서 "○○ 앱에서는…" 식으로 맞춤 문구를 보여주는 데 사용한다.
 * @returns {string | null} 앱 이름(예: '카카오톡') 또는 null
 */
export function getInAppBrowserName() {
    const ua = navigator.userAgent || navigator.vendor || '';
    if (/KAKAOTALK/i.test(ua)) return '카카오톡';
    if (/NAVER/i.test(ua)) return '네이버';
    if (/BAND\//i.test(ua)) return '밴드';
    if (/kakaostory/i.test(ua)) return '카카오스토리';
    if (/DaumApps/i.test(ua)) return '다음';
    if (/Line\//i.test(ua)) return '라인';
    if (/FBAN|FBAV/i.test(ua)) return '페이스북';
    if (/Instagram/i.test(ua)) return '인스타그램';
    return null;
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
