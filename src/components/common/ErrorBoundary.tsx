import { Component, ReactNode, ErrorInfo } from 'react';
import { captureError } from '../../lib/sentry';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    /** DOM NotFoundError(code 8)인지 확인 — 브라우저별 메시지가 다르므로 이름+코드로 판별 */
    private static isDomNotFoundError(error: Error): boolean {
        return (
            error.name === 'NotFoundError' ||
            ('code' in error && (error as DOMException).code === 8)
        );
    }

    static getDerivedStateFromError(error: Error): State {
        // DOM NotFoundError는 렌더링에 영향 없으므로 에러 페이지를 보여줄 필요 없음
        if (ErrorBoundary.isDomNotFoundError(error)) {
            return { hasError: false, error: null };
        }
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        // DOM NotFoundError는 Sentry에도 보내지 않음 (sentry.ts에서도 필터링하지만 이중 방어)
        if (ErrorBoundary.isDomNotFoundError(error)) return;
        captureError(error, { componentStack: errorInfo?.componentStack });
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null });
        window.location.reload();
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-surface-950 p-6">
                    <div className="text-center max-w-md">
                        <div className="text-6xl mb-4">😥</div>
                        <h2 className="text-xl font-bold text-gray-800 dark:text-surface-100 mb-2">
                            문제가 발생했습니다
                        </h2>
                        <p className="text-gray-500 dark:text-surface-400 mb-6 text-sm">
                            일시적인 오류가 발생했습니다. 새로고침하면 해결될 수 있습니다.
                        </p>
                        <button
                            onClick={this.handleReset}
                            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg
                                       hover:bg-blue-700 dark:hover:bg-blue-500 transition-colors font-medium"
                        >
                            🔄 새로고침
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
