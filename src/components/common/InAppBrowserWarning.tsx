import { useState } from 'react';
import { openInExternalBrowser, copyUrlToClipboard, getInAppBrowserName } from '../../lib/inAppBrowser';

export default function InAppBrowserWarning() {
    const [copied, setCopied] = useState(false);
    const appName = getInAppBrowserName();

    /** 공유할 URL 획득 */
    const getShareUrl = () => {
        return window.location.href;
    };

    /** 외부 브라우저로 전환 */
    const handleOpenExternal = () => {
        openInExternalBrowser(getShareUrl());
    };

    /** URL 복사 */
    const handleCopyUrl = async () => {
        const ok = await copyUrlToClipboard(getShareUrl());
        if (ok) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-primary-600 via-primary-700 to-primary-900 px-4 py-8">
            <div className="relative w-full max-w-sm glass-card p-6 space-y-5 animate-scale-in">
                <div className="text-center">
                    <div className="w-12 h-12 mx-auto mb-3 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center">
                        <svg className="w-6 h-6 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                        </svg>
                    </div>
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                        {appName ? `${appName} 앱에서는 로그인이 안 돼요` : '외부 브라우저가 필요해요'}
                    </h2>
                    <p className="text-sm text-surface-500 dark:text-surface-400 leading-relaxed">
                        구글 보안 정책상 앱 안에서는 구글 로그인이 차단됩니다.<br />
                        크롬·사파리 같은 기본 브라우저로 열어 주세요.
                    </p>
                </div>

                {/* 1순위: 외부 브라우저로 열기 버튼 */}
                <button
                    onClick={handleOpenExternal}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary-600 dark:bg-primary-500 text-white rounded-xl font-medium hover:bg-primary-700 transition-all duration-200 active:scale-[0.98]"
                >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                    </svg>
                    외부 브라우저에서 열기
                </button>

                {/* 폴백: 버튼이 동작하지 않을 때 수동 안내 + URL 복사 */}
                <div className="rounded-xl bg-surface-50 dark:bg-surface-800/50 border border-surface-200 dark:border-surface-700 p-4 space-y-3">
                    <p className="text-xs font-medium text-surface-600 dark:text-surface-300">
                        버튼이 동작하지 않으면, 이렇게 해보세요
                    </p>
                    <ol className="text-xs text-surface-500 dark:text-surface-400 space-y-1.5 list-decimal list-inside leading-relaxed">
                        <li>오른쪽 위 또는 아래의 더보기(⋮) 메뉴 → <span className="font-medium text-surface-600 dark:text-surface-300">&ldquo;다른 브라우저로 열기&rdquo;</span></li>
                        <li>또는 아래 버튼으로 주소를 복사한 뒤, 크롬·사파리 주소창에 붙여넣기</li>
                    </ol>

                    {/* URL 복사 버튼 */}
                    <button
                        onClick={handleCopyUrl}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-xl text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800/50 hover:shadow-md transition-all duration-200 active:scale-[0.98]"
                    >
                        {copied ? (
                            <>
                                <svg className="w-5 h-5 text-green-500 dark:text-green-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                                </svg>
                                복사 완료!
                            </>
                        ) : (
                            <>
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                                </svg>
                                주소(URL) 복사하기
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
