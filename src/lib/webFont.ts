/**
 * 본 웹 폰트(Pretendard) 로드 — **로그인한 사용자용 앱에서만** 붙인다.
 *
 * ## 왜 index.html이 아니라 여기인가
 *
 * 예전에는 index.html이 cdn.jsdelivr.net의 폰트 스타일시트를 직접 걸었다. 스타일시트는
 * 렌더 블로킹이므로 첫 페인트가 제3자 호스트의 DNS+TCP+TLS(느린 4G에서 3 RTT) 뒤로 밀렸고,
 * 2026-08-23 GitHub 러너 실측에서 FCP 7.4~7.6초 / LCP 8.8~11.0초가 나왔다(주간 Lighthouse
 * 게이트가 도입 후 계속 실패한 원인). 그래서 폰트를 같은 오리진으로 옮겼다(public/fonts/).
 *
 * 그 과정에서 두 번째 사실이 드러났다. @font-face의 family는 'Pretendard Variable'인데
 * --font-sans에는 'Pretendard'만 적혀 있어 **받아 온 폰트가 적용되지도 않았다**(family
 * 이름은 정확히 일치해야 한다). 비용만 내고 화면은 폴백 서체로 그려지던 상태다.
 *
 * 이름을 맞춰 실제로 적용해 보니, 한글 동적 서브셋은 텍스트가 걸치는 유니코드 구간마다
 * 조각을 받아 랜딩 한 화면에 **약 320KB**가 붙었다. 로컬 3회 실측(느린 4G 시뮬레이션):
 *
 *   폰트 미적용:  performance 0.93 / LCP 2942~3017ms / FCP 1882~1891ms / 178KB
 *   폰트 적용:    performance 0.71 / LCP 5085~5161ms / FCP 3993~4029ms / 497KB
 *
 * 페인트를 막아서가 아니라(모든 @font-face가 font-display: swap) 그 대역폭이 JS와 경쟁해
 * CSR 렌더가 밀리는 것이다. `font-display: optional`과 load 이후 주입도 재 봤지만 둘 다
 * 개선이 없었다(4.0s/5.1s 그대로).
 *
 * 그래서 이미 있는 경계를 그대로 쓴다 — main.tsx가 비인증 사용자에게는 lightEntry(랜딩·로그인),
 * 인증 사용자에게는 appEntry를 로드한다. 공개 랜딩은 폴백 서체로 빠르게 뜨고(첫 방문 1회성
 * 마케팅 화면), 직원이 매일 쓰는 앱은 Pretendard로 뜬다 — 앱 사용자는 첫 로드에서만 폰트를
 * 받고 이후에는 캐시(firebase.json의 1년 immutable + sw.ts의 self-hosted-fonts)에서 온다.
 *
 * 전체 화면에 폰트를 적용하려면 index.html에 이 CSS를 <link>로 걸면 된다 — 대신 위 표의
 * 랜딩 비용을 받아들이고 lighthouserc.json의 임계치를 다시 잡아야 한다.
 */

/** public/fonts/ 아래 자체 호스팅 경로. 버전이 경로에 있어 갱신 시 URL이 바뀐다(캐시 무효화). */
export const WEB_FONT_HREF = '/fonts/pretendard-1.3.9/pretendardvariable-dynamic-subset.css';

/**
 * 폰트 스타일시트를 <head>에 붙인다. 두 번 불려도 하나만 남는다
 * (엔트리가 재실행되는 개발 중 HMR·테스트에서 중복 요청을 만들지 않기 위함).
 */
export function loadWebFont(doc: Document = document): void {
    if (doc.querySelector(`link[rel="stylesheet"][href="${WEB_FONT_HREF}"]`)) return;
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = WEB_FONT_HREF;
    doc.head.appendChild(link);
}
