import { useState, useCallback, useEffect } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useConfirm } from '../../../hooks/useConfirm';
import { useToast } from '../../../hooks/useToast';

/** 단일 API 헬스 결과 */
interface ApiHealthResult {
    name: string;
    displayName: string;
    status: 'ok' | 'degraded' | 'error';
    latencyMs: number;
    error?: string;
    checkedAt: string;
}

const STATUS_CONFIG = {
    ok: {
        emoji: '🟢',
        label: '정상',
        textClass: 'text-emerald-600 dark:text-emerald-400',
        bgClass: 'bg-emerald-50 dark:bg-emerald-900/20',
        borderClass: 'border-emerald-200 dark:border-emerald-800',
        dotClass: 'bg-emerald-500',
    },
    degraded: {
        emoji: '🟡',
        label: '지연',
        textClass: 'text-amber-600 dark:text-amber-400',
        bgClass: 'bg-amber-50 dark:bg-amber-900/20',
        borderClass: 'border-amber-200 dark:border-amber-800',
        dotClass: 'bg-amber-500',
    },
    error: {
        emoji: '🔴',
        label: '에러',
        textClass: 'text-red-600 dark:text-red-400',
        bgClass: 'bg-red-50 dark:bg-red-900/20',
        borderClass: 'border-red-200 dark:border-red-800',
        dotClass: 'bg-red-500',
    },
} as const;

/** 응답 시간 포맷 */
function formatLatency(ms: number): string {
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
    return `${ms}ms`;
}

/** 헬스 체크 응답 타입 */
interface HealthCheckResponse {
    results: ApiHealthResult[];
    internalResults: ApiHealthResult[];
}

export default function DashboardApiHealth() {
    const { confirm } = useConfirm();
    const { showToast } = useToast();
    const [results, setResults] = useState<ApiHealthResult[] | null>(null);
    const [internalResults, setInternalResults] = useState<ApiHealthResult[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [resetting, setResetting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastChecked, setLastChecked] = useState<string | null>(null);

    const runHealthCheck = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const functions = getFunctions(undefined, 'asia-northeast3');
            const fn = httpsCallable<void, HealthCheckResponse>(functions, 'apiHealthCheck');
            const response = await fn();
            setResults(response.data.results);
            setInternalResults(response.data.internalResults || []);
            setLastChecked(new Date().toLocaleTimeString('ko-KR'));
        } catch (err: unknown) {
            const message = (err as Error).message || '헬스 체크 실행 실패';
            setError(message);
        } finally {
            setLoading(false);
        }
    }, []);

    /** 캘린더 동기화 실패 카운터 리셋 */
    const resetCalendarSync = useCallback(async () => {
        const confirmed = await confirm({
            title: '캘린더 동기화 리셋',
            message: '캘린더 동기화 실패 카운터를 리셋하시겠습니까?\n모든 차량이 다음 주기에 재시도됩니다.',
            confirmText: '리셋',
            cancelText: '취소',
        });
        if (!confirmed) return;
        setResetting(true);
        try {
            const functions = getFunctions(undefined, 'asia-northeast3');
            const fn = httpsCallable<void, { resetCount: number; message: string }>(functions, 'resetCalendarSyncFails');
            const response = await fn();
            showToast(response.data.message, 'success');
            // 헬스 체크 새로고침
            await runHealthCheck();
        } catch (err: unknown) {
            showToast('리셋 실패: ' + ((err as Error).message || '알 수 없는 오류'), 'error');
        } finally {
            setResetting(false);
        }
    }, [runHealthCheck, confirm, showToast]);

    // 컴포넌트 마운트 시 자동 실행
    useEffect(() => {
        runHealthCheck();
    }, [runHealthCheck]);

    // 전체 요약 통계 (외부 + 내부)
    const allResults = [...(results || []), ...(internalResults || [])];
    const summary = allResults.length > 0
        ? {
              ok: allResults.filter(r => r.status === 'ok').length,
              degraded: allResults.filter(r => r.status === 'degraded').length,
              error: allResults.filter(r => r.status === 'error').length,
          }
        : null;

    // 캘린더 동기화 에러 여부 (리셋 버튼 표시용)
    const hasCalendarIssue = internalResults?.some(
        r => r.name === 'calendarSync' && r.status !== 'ok'
    );

    return (
        <div className="glass-card p-5">
            {/* 헤더 */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <span className="text-xl">🏥</span>
                    <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">
                        API 헬스 체크
                    </h2>
                    {summary && (
                        <div className="flex items-center gap-1.5 ml-2">
                            {summary.ok > 0 && (
                                <span className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded-full">
                                    🟢 {summary.ok}
                                </span>
                            )}
                            {summary.degraded > 0 && (
                                <span className="inline-flex items-center gap-0.5 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded-full">
                                    🟡 {summary.degraded}
                                </span>
                            )}
                            {summary.error > 0 && (
                                <span className="inline-flex items-center gap-0.5 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 px-1.5 py-0.5 rounded-full">
                                    🔴 {summary.error}
                                </span>
                            )}
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {lastChecked && (
                        <span className="text-xs text-surface-400">{lastChecked} 기준</span>
                    )}
                    <button
                        onClick={runHealthCheck}
                        disabled={loading}
                        className="btn-ghost text-sm flex items-center gap-1 disabled:opacity-50"
                    >
                        <svg
                            className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={1.5}
                            stroke="currentColor"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182"
                            />
                        </svg>
                        {loading ? '확인 중...' : '새로고침'}
                    </button>
                </div>
            </div>

            {/* 에러 메시지 */}
            {error && (
                <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
                    ⚠️ {error}
                </div>
            )}

            {/* 로딩 스켈레톤 */}
            {loading && !results && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                    {[...Array(5)].map((_, i) => (
                        <div
                            key={i}
                            className="p-4 rounded-xl border border-surface-200 dark:border-surface-700 animate-pulse"
                        >
                            <div className="h-4 bg-surface-200 dark:bg-surface-700 rounded w-20 mb-3" />
                            <div className="h-6 bg-surface-200 dark:bg-surface-700 rounded w-12 mb-2" />
                            <div className="h-3 bg-surface-200 dark:bg-surface-700 rounded w-16" />
                        </div>
                    ))}
                </div>
            )}

            {/* API 상태 카드 그리드 */}
            {results && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                    {results.map((api) => {
                        const cfg = STATUS_CONFIG[api.status];
                        return (
                            <div
                                key={api.name}
                                className={`relative p-4 rounded-xl border transition-all duration-300 ${cfg.bgClass} ${cfg.borderClass} ${
                                    loading ? 'opacity-60' : ''
                                }`}
                            >
                                {/* 상태 표시등 (우상단) */}
                                <div className="absolute top-3 right-3">
                                    <span
                                        className={`inline-block w-2.5 h-2.5 rounded-full ${cfg.dotClass} ${
                                            api.status === 'ok' ? 'animate-pulse' : ''
                                        }`}
                                    />
                                </div>

                                {/* API 이름 */}
                                <p className="text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
                                    {api.displayName}
                                </p>

                                {/* 상태 + 이모지 */}
                                <div className="flex items-center gap-1.5 mb-1.5">
                                    <span className="text-lg">{cfg.emoji}</span>
                                    <span className={`text-sm font-semibold ${cfg.textClass}`}>
                                        {cfg.label}
                                    </span>
                                </div>

                                {/* 응답 시간 */}
                                <p className="text-xs text-surface-500 dark:text-surface-400">
                                    응답: {formatLatency(api.latencyMs)}
                                </p>

                                {/* 에러 메시지 (있을 때만) */}
                                {api.error && (
                                    <p className="mt-2 text-xs text-red-500 dark:text-red-400 truncate" title={api.error}>
                                        {api.error}
                                    </p>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* 내부 서비스 상태 */}
            {internalResults && internalResults.length > 0 && (
                <>
                    <div className="flex items-center gap-2 mt-5 mb-3">
                        <span className="text-base">⚙️</span>
                        <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300">
                            내부 서비스
                        </h3>
                        <span className="inline-flex items-center gap-0.5 text-xs font-medium text-surface-500 bg-surface-100 dark:bg-surface-800 px-1.5 py-0.5 rounded-full">
                            {internalResults.length}
                        </span>
                        {hasCalendarIssue && (
                            <button
                                onClick={resetCalendarSync}
                                disabled={resetting}
                                className="ml-auto btn-ghost text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 disabled:opacity-50"
                            >
                                {resetting ? '리셋 중...' : '🔄 동기화 리셋'}
                            </button>
                        )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {internalResults.map((api) => {
                            const cfg = STATUS_CONFIG[api.status];
                            return (
                                <div
                                    key={api.name}
                                    className={`relative p-4 rounded-xl border transition-all duration-300 ${cfg.bgClass} ${cfg.borderClass} ${
                                        loading ? 'opacity-60' : ''
                                    }`}
                                >
                                    <div className="absolute top-3 right-3">
                                        <span
                                            className={`inline-block w-2.5 h-2.5 rounded-full ${cfg.dotClass} ${
                                                api.status === 'ok' ? 'animate-pulse' : ''
                                            }`}
                                        />
                                    </div>
                                    <p className="text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
                                        {api.displayName}
                                    </p>
                                    <div className="flex items-center gap-1.5 mb-1.5">
                                        <span className="text-lg">{cfg.emoji}</span>
                                        <span className={`text-sm font-semibold ${cfg.textClass}`}>
                                            {cfg.label}
                                        </span>
                                    </div>
                                    {api.latencyMs > 0 && (
                                        <p className="text-xs text-surface-500 dark:text-surface-400">
                                            응답: {formatLatency(api.latencyMs)}
                                        </p>
                                    )}
                                    {api.error && (
                                        <p className="mt-2 text-xs text-red-500 dark:text-red-400 truncate" title={api.error}>
                                            {api.error}
                                        </p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </>
            )}

            {/* 안내 메시지 */}
            <p className="mt-3 text-xs text-surface-400">
                * 각 API에 가벼운 핑을 보내 응답 속도와 가용성을 확인합니다. 🟢 정상(3초 미만) · 🟡 지연(3초 이상) · 🔴 에러(응답 없음)
            </p>
        </div>
    );
}
