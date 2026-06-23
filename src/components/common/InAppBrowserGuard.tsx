import { type ReactNode } from 'react';
import { isInAppBrowser } from '../../lib/inAppBrowser';
import InAppBrowserWarning from './InAppBrowserWarning';

/**
 * 인앱 브라우저(카톡·네이버 등) 가드.
 *
 * 카톡·네이버 같은 인앱 브라우저에서는 구글 로그인이 차단(disallowed_useragent)되므로,
 * 구글 로그인이 필요한 화면을 이 가드로 감싸면 인앱일 때 외부 브라우저 안내 화면으로
 * 대체된다.
 *
 * 렌더 경로가 둘로 갈리므로(비로그인=lightEntry / 로그인=appEntry→App.tsx) 가드가
 * 한쪽에만 남아 우회되는 회귀가 있었다. 이 컴포넌트로 가드 의도를 한 곳에서 관리하고,
 * 두 경로 모두 동일하게 적용한다. 회귀는 e2e/inapp-browser-guard.spec.ts가 검증한다.
 */
export default function InAppBrowserGuard({ children }: { children: ReactNode }) {
    if (isInAppBrowser()) {
        return <InAppBrowserWarning />;
    }
    return <>{children}</>;
}
