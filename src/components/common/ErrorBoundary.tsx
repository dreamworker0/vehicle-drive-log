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

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
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
