import { useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { firebaseFunctions } from '../../../lib/firebase';

interface SlackIntegrationSummary {
    organizationId: string;
    organizationName: string | null;
    teamName: string | null;
    botUserId: string | null;
    active: boolean;
    connectedAt: string | null;
    disconnectedAt: string | null;
}

interface SlackIntegrationsResult {
    integrations: SlackIntegrationSummary[];
    activeCount: number;
}

interface Props {
    /** 전체 승인 기관 수 (연동율 계산용) */
    totalOrgs: number;
}

const fmtDate = (iso: string | null) =>
    iso
        ? new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
        : '-';

/**
 * Slack 연결 기관 현황 — 슈퍼관리자 대시보드(운영 요약 탭).
 * integrations 문서는 Rules로 클라이언트 직접 접근이 차단돼 있어
 * listSlackIntegrations 콜러블(superAdmin 전용)로만 조회한다.
 */
export default function SlackIntegrationStatus({ totalOrgs }: Props) {
    const [data, setData] = useState<SlackIntegrationsResult | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const fn = httpsCallable<unknown, SlackIntegrationsResult>(firebaseFunctions, 'listSlackIntegrations');
                const { data: res } = await fn();
                if (alive) setData(res);
            } catch (err) {
                console.error('[Dashboard] Slack 연결 현황 로드 실패:', err);
                if (alive) setError(true);
            } finally {
                if (alive) setLoading(false);
            }
        })();
        return () => { alive = false; };
    }, []);

    const pct = useMemo(() => {
        if (!data || totalOrgs <= 0) return 0;
        return Math.round((data.activeCount / totalOrgs) * 100);
    }, [data, totalOrgs]);

    return (
        <div className="glass-card p-5">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-4 flex items-center gap-2">
                <span role="img" aria-label="slack">💬</span> Slack 연결 기관 현황
            </h2>

            {loading ? (
                <div className="flex items-center justify-center py-12 text-surface-400 dark:text-surface-500">
                    <div className="w-6 h-6 spinner" />
                </div>
            ) : error ? (
                <div className="flex flex-col items-center justify-center py-12 text-surface-400 dark:text-surface-500">
                    현황을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.
                </div>
            ) : (
                <>
                    {/* 요약 카드 */}
                    <div className="mb-5 p-4 bg-surface-50 dark:bg-surface-800 rounded-lg border border-surface-100 dark:border-surface-700 flex items-center gap-4">
                        <div className="flex flex-col">
                            <span className="text-xs text-surface-500 dark:text-surface-400">연결된 기관</span>
                            <span className="text-3xl font-bold text-[#4A154B] dark:text-purple-300">
                                {data?.activeCount ?? 0}
                                <span className="text-base font-medium text-surface-400 dark:text-surface-500"> / {totalOrgs}곳</span>
                            </span>
                        </div>
                        <div className="ml-auto text-right">
                            <span className="text-2xl font-bold text-surface-700 dark:text-surface-200">{pct}%</span>
                            <p className="text-xs text-surface-400 dark:text-surface-500">전체 기관 중 연동율</p>
                        </div>
                    </div>

                    {/* 기관 표 */}
                    {(data?.integrations.length ?? 0) === 0 ? (
                        <div className="flex flex-col items-center justify-center py-8 text-surface-400 dark:text-surface-500">
                            아직 Slack을 연결한 기관이 없습니다.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider border-b border-surface-200 dark:border-surface-700">
                                        <th className="py-2 pr-3">기관</th>
                                        <th className="py-2 px-3">워크스페이스</th>
                                        <th className="py-2 px-3">상태</th>
                                        <th className="py-2 pl-3 whitespace-nowrap">연결일</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data!.integrations.map((it, idx) => (
                                        <tr
                                            key={it.organizationId || idx}
                                            className="border-b border-surface-100 dark:border-surface-800 last:border-0"
                                        >
                                            <td className="py-2.5 pr-3 text-surface-800 dark:text-surface-100 font-medium">
                                                {it.organizationName || <span className="text-surface-400">{it.organizationId || '알 수 없음'}</span>}
                                            </td>
                                            <td className="py-2.5 px-3 text-surface-600 dark:text-surface-300">
                                                {it.teamName || '-'}
                                            </td>
                                            <td className="py-2.5 px-3">
                                                {it.active ? (
                                                    <span className="inline-flex items-center gap-1 text-xs font-medium bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full">
                                                        연결됨
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-xs font-medium bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400 px-2 py-0.5 rounded-full">
                                                        해제됨
                                                    </span>
                                                )}
                                            </td>
                                            <td className="py-2.5 pl-3 text-surface-500 dark:text-surface-400 whitespace-nowrap">
                                                {it.active ? fmtDate(it.connectedAt) : fmtDate(it.disconnectedAt)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
