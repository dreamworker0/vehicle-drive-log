import { Component, ReactNode, ErrorInfo } from 'react';
import { isStaleChunkError } from '../../lib/staleChunk';
import NewVersionScreen from './NewVersionScreen';

/**
 * 비인증(경량) 엔트리용 에러 경계.
 *
 * `ErrorBoundary`는 `lib/sentry`를 정적으로 가져오는데, 경량 엔트리는 Sentry를 **일부러**
 * 빼 둔 자리다(랜딩 임계 경로). 그래서 같은 역할을 하되 Sentry를 정적 간선으로 만들지 않는
 * 경계를 따로 둔다 — 보고는 에러가 났을 때만 동적 import로 한다.
 *
 * 필요한 이유: 경량 엔트리의 라우트가 지연 로딩(`lazyWithRetry`)으로 바뀌면서, 청크를
 * 두 번 연속 못 받으면 예외가 최상단까지 올라간다. 경계가 없으면 React가 트리를 통째로
 * 버려 **빈 흰 화면**이 남는다 — 로그인·약관·기관 신청 같은 공개 화면이 전부 그 대상이다.
 */
interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    /** 배포로 옛 파일이 사라져 난 오류인가 — 그렇다면 오류 대신 새 버전 안내를 띄운다 */
    staleVersion: boolean;
}

export default class LightErrorBoundary extends Component<Props, State> {
    state: State = { hasError: false, staleVersion: false };

    static getDerivedStateFromError(error: unknown): State {
        // 오프라인이면 같은 원문이 회선 단절에서도 나오므로 업데이트로 단정하지 않는다
        return { hasError: true, staleVersion: isStaleChunkError(error) && navigator.onLine };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        // Sentry는 여기서만, 그것도 실패한 뒤에만 끌어온다(임계 경로 오염 방지).
        import('../../lib/sentry')
            .then(({ captureError }) => captureError(error, { componentStack: errorInfo?.componentStack }))
            .catch(() => { /* 보고 실패는 화면 복구보다 덜 중요하다 */ });
    }

    render() {
        if (!this.state.hasError) return this.props.children;
        if (this.state.staleVersion) return <NewVersionScreen />;

        return (
            <div className="min-h-screen flex items-center justify-center p-6 bg-surface-50 dark:bg-surface-950">
                <div className="text-center max-w-sm">
                    <p className="text-base font-semibold text-surface-900 dark:text-surface-100 mb-2">
                        화면을 불러오지 못했습니다
                    </p>
                    <p className="text-sm leading-relaxed text-surface-600 dark:text-surface-400 mb-5">
                        네트워크 상태를 확인한 뒤 다시 시도해 주세요.
                    </p>
                    <button
                        type="button"
                        onClick={() => window.location.reload()}
                        className="min-h-12 px-6 rounded-xl bg-indigo-600 text-white text-sm font-semibold"
                    >
                        다시 시도
                    </button>
                </div>
            </div>
        );
    }
}
