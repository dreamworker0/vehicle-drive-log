import { useState } from 'react';
import { reloadToLatest } from '../../lib/pendingUpdate';

/**
 * 오류 경계가 잡은 예외가 **배포로 옛 파일이 사라진 것**(`isStaleChunkError`)일 때 보여 주는 화면.
 *
 * 화면을 옮기다 옛 파일을 못 찾으면 `lazyWithRetry`가 한 번 자동 새로고침한다. 그래도 또
 * 실패하면 예외가 오류 경계까지 올라오는데, 그때 "😥 문제가 발생했습니다 / 일시적인 오류"를
 * 보여 주면 실무자는 앱이 고장 났다고 받아들였다. 원인은 고장이 아니라 업데이트이므로
 * 사실대로 알리고, 버튼 하나로 새 버전을 열게 한다.
 *
 * 버튼은 `reloadToLatest` — 서비스 워커 업데이트를 먼저 확인한 뒤 새로고침한다. 그냥
 * 새로고침하면 옛 워커가 옛 화면을 다시 내줘 같은 화면이 되풀이될 수 있다.
 *
 * `ErrorBoundary`(전체 앱)와 `LightErrorBoundary`(로그인 전 화면)가 함께 쓴다. 경량 화면에서도
 * 쓰므로 Sentry 같은 무거운 모듈을 가져오지 않는다.
 */
export default function NewVersionScreen() {
    const [updating, setUpdating] = useState(false);

    const handleUpdate = () => {
        setUpdating(true);
        void reloadToLatest();
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-surface-50 dark:bg-surface-950">
            <div className="text-center max-w-sm">
                <div className="text-5xl mb-4" aria-hidden="true">✨</div>
                <h2 className="text-lg font-bold text-surface-900 dark:text-surface-100 mb-2">
                    새 버전이 나왔어요
                </h2>
                <p className="text-sm leading-relaxed text-surface-600 dark:text-surface-400 mb-6">
                    앱이 업데이트되어 화면을 새로 불러와야 해요.
                    <br />
                    아래 버튼을 누르면 새 버전으로 열려요.
                </p>
                <button
                    type="button"
                    onClick={handleUpdate}
                    disabled={updating}
                    className="min-h-12 px-6 rounded-xl bg-indigo-600 dark:bg-indigo-700 text-white text-sm font-semibold hover:bg-indigo-700 dark:hover:bg-indigo-600 disabled:opacity-70 transition-colors"
                >
                    {updating ? '새 버전을 여는 중…' : '새 버전으로 열기'}
                </button>
            </div>
        </div>
    );
}
