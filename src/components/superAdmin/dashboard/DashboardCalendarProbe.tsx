/**
 * DashboardCalendarProbe — 연동 캘린더 일괄 접근 진단 (슈퍼관리자)
 *
 * `calendarSyncFailCount >= 10`인 차량은 스케줄러도 트리거도 호출하지 않으므로,
 * 그 시점 이후 **공유가 살아났는지 죽었는지 아무도 모른다.** 이 패널은 운영 경로와 같은
 * 순서(값 형식 → 기관 바인딩 → 캘린더 접근)로 지금 다시 물어, 카운터만 되돌리면 되는
 * 기관과 재연동이 필요한 기관을 가른다.
 *
 * '🔄 동기화 리셋'을 누르기 전에 여기를 먼저 본다 — 죽은 캘린더까지 재시도에 풀면
 * 며칠에 걸쳐 도로 영구중단으로 돌아가고 대시보드만 잠깐 초록이 된다.
 */
import { useCallback, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useToast } from '../../../hooks/useToast';

type ProbeVerdict =
    | 'ok'
    | 'not_found'
    | 'forbidden'
    | 'rate_limited'
    | 'bound_to_other_org'
    | 'service_account_address'
    | 'malformed'
    | 'error';

interface ProbeRow {
    calendarId: string;
    organizationId: string;
    organizationName: string;
    organizationStatus: string;
    calendarEnabled: boolean;
    vehicleCount: number;
    blockedVehicleCount: number;
    vehicleNames: string[];
    maxFailCount: number;
    verdict: ProbeVerdict;
    detail?: string;
}

interface ProbeSummary {
    probedRows: number;
    probedVehicles: number;
    blockedVehicles: number;
    calendarApiCalls: number;
    okRows: number;
    resettableRows: number;
    resettableVehicles: number;
    needsOrgActionRows: number;
    needsOrgActionVehicles: number;
    inconclusiveRows: number;
    inconclusiveVehicles: number;
    falsePositiveRows: number;
    falsePositiveVehicles: number;
    truncated: boolean;
    totalRows: number;
}

interface ProbeResponse {
    summary: ProbeSummary;
    rows: ProbeRow[];
}

/**
 * 서버 타임아웃과 같은 값. httpsCallable 기본값은 70초라, 이 옵션을 빼면 서버가 300초를
 * 잡아 둔 의미가 없다 — 클라이언트가 먼저 끊고 결과를 버리는 동안 캘린더 쿼터만 탄다.
 */
const CALLABLE_TIMEOUT_MS = 300_000;

/** 판정별 표시 — 라벨은 "무엇을 해야 하는가"가 바로 읽히게 쓴다. */
const VERDICT_CONFIG: Record<ProbeVerdict, { emoji: string; label: string; action: string; chipClass: string }> = {
    ok: {
        emoji: '🟢',
        label: '접근 가능',
        action: '카운터 리셋만으로 복구',
        chipClass: 'bg-accent-50 text-accent-600 dark:bg-accent-900/30 dark:text-accent-400',
    },
    not_found: {
        emoji: '🔴',
        label: '캘린더 없음 (404)',
        action: '기관이 캘린더를 다시 만들거나 공유해야 함',
        chipClass: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400',
    },
    forbidden: {
        emoji: '🟠',
        label: '권한 부족 (403)',
        action: "기관이 서비스 계정을 '일정 변경' 권한으로 다시 초대해야 함",
        chipClass: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400',
    },
    bound_to_other_org: {
        emoji: '🔵',
        label: '다른 기관 귀속',
        action: '접근되더라도 동기화는 건너뛴다 — 리셋해도 복구되지 않으므로 캘린더 ID부터 바로잡아야 함',
        chipClass: 'bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-400',
    },
    service_account_address: {
        emoji: '⚠️',
        label: '서비스 계정 주소 오입력',
        action: "캘린더 ID 칸에 공유 대상 주소가 들어 있음 — 기관이 '캘린더 ID'로 교체",
        chipClass: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400',
    },
    malformed: {
        emoji: '⚠️',
        label: '캘린더 ID 형식 아님',
        action: '화면 URL 등이 들어 있음 — 기관이 캘린더 ID로 교체',
        chipClass: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400',
    },
    rate_limited: {
        emoji: '⏳',
        label: '쿼터·유량 제한',
        action: '캘린더 상태를 알 수 없음 — 잠시 뒤 다시 진단 (기관 안내 대상 아님)',
        chipClass: 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-300',
    },
    error: {
        emoji: '⚪',
        label: '기타 오류',
        action: '상세 메시지 확인 필요 — 판정 보류',
        chipClass: 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-300',
    },
};

export default function DashboardCalendarProbe() {
    const { showToast } = useToast();
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<ProbeResponse | null>(null);
    const [includeHealthy, setIncludeHealthy] = useState(false);

    const runProbe = useCallback(async () => {
        setLoading(true);
        try {
            const functions = getFunctions(undefined, 'asia-northeast3');
            const fn = httpsCallable<{ includeHealthy: boolean }, ProbeResponse>(
                functions,
                'probeCalendarAccess',
                { timeout: CALLABLE_TIMEOUT_MS },
            );
            const res = await fn({ includeHealthy });
            setData(res.data);
        } catch (err: unknown) {
            const code = (err as { code?: string }).code || '';
            const message = code.includes('deadline-exceeded')
                ? '진단이 제한 시간을 넘겼습니다. 대상이 많으면 나눠서 다시 시도하세요.'
                : (err as Error).message || '알 수 없는 오류';
            showToast('진단 실패: ' + message, 'error');
        } finally {
            setLoading(false);
        }
    }, [includeHealthy, showToast]);

    const summary = data?.summary;

    return (
        <div className="mt-5 pt-5 border-t border-surface-100 dark:border-surface-700">
            <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-base">🔍</span>
                <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300">
                    캘린더 연동 진단
                </h3>
                <span className="text-xs text-surface-500 dark:text-surface-400">
                    진단 대상을 바꾸지 않음 · 리셋 전에 무엇이 살아 있는지 확인
                </span>

                <label className="ml-auto flex items-center gap-1.5 text-xs text-surface-500 dark:text-surface-400 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={includeHealthy}
                        onChange={(e) => setIncludeHealthy(e.target.checked)}
                        className="rounded border-surface-200 dark:border-surface-600"
                    />
                    정상 차량까지 포함
                </label>
                <button
                    onClick={runProbe}
                    disabled={loading}
                    aria-busy={loading}
                    className="btn-ghost text-xs text-primary-600 dark:text-primary-400 flex items-center gap-1 disabled:opacity-50 min-h-[48px]"
                >
                    {loading ? '진단 중...' : '🔍 연동 진단 실행'}
                </button>
            </div>

            <div aria-live="polite">
                {loading && (
                    <p className="text-xs text-surface-500 dark:text-surface-400">
                        캘린더마다 접근을 확인하는 중입니다. 대상이 많으면 1분 이상 걸릴 수 있습니다.
                    </p>
                )}

                {summary && !loading && (
                    <>
                        {/* 요약 — 서로 겹치지 않는 네 갈래. 합계가 아래 '영구중단 차량'과 맞는다. */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                            <div className="p-3 rounded-xl border bg-accent-50 dark:bg-accent-900/20 border-accent-200 dark:border-accent-800/40">
                                <p className="text-xs text-surface-500 dark:text-surface-400 mb-1">리셋만으로 복구</p>
                                <p className="text-lg font-bold text-accent-600 dark:text-accent-400">
                                    {summary.resettableVehicles}대
                                    <span className="ml-1 text-xs font-normal">/ {summary.resettableRows}건</span>
                                </p>
                            </div>
                            <div className="p-3 rounded-xl border bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/40">
                                <p className="text-xs text-surface-500 dark:text-surface-400 mb-1">기관 조치 필요</p>
                                <p className="text-lg font-bold text-red-600 dark:text-red-400">
                                    {summary.needsOrgActionVehicles}대
                                    <span className="ml-1 text-xs font-normal">/ {summary.needsOrgActionRows}건</span>
                                </p>
                            </div>
                            <div className="p-3 rounded-xl border bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/40">
                                <p className="text-xs text-surface-500 dark:text-surface-400 mb-1">판정 보류 (쿼터·오류)</p>
                                <p className="text-lg font-bold text-amber-600 dark:text-amber-400">
                                    {summary.inconclusiveVehicles}대
                                    <span className="ml-1 text-xs font-normal">/ {summary.inconclusiveRows}건</span>
                                </p>
                            </div>
                            <div className="p-3 rounded-xl border bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-700">
                                <p className="text-xs text-surface-500 dark:text-surface-400 mb-1">헬스체크 오탐 (기능 OFF·기관 없음)</p>
                                <p className="text-lg font-bold text-surface-600 dark:text-surface-300">
                                    {summary.falsePositiveVehicles}대
                                    <span className="ml-1 text-xs font-normal">/ {summary.falsePositiveRows}건</span>
                                </p>
                            </div>
                        </div>

                        <p className="text-xs text-surface-500 dark:text-surface-400 mb-2">
                            진단 대상 {summary.probedRows}건 · 차량 {summary.probedVehicles}대
                            (영구중단 {summary.blockedVehicles}대) · 캘린더 API 호출 {summary.calendarApiCalls}회
                            {summary.truncated && (
                                <span className="ml-1 text-amber-600 dark:text-amber-400">
                                    (상한 초과 — 전체 {summary.totalRows}건 중 심각한 것부터 일부만 진단했습니다)
                                </span>
                            )}
                        </p>

                        {/* 상세 */}
                        {data.rows.length > 0 ? (
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <caption className="sr-only">
                                        기관별 캘린더 연동 진단 결과 — 판정과 필요한 조치
                                    </caption>
                                    <thead>
                                        <tr className="text-left text-surface-500 dark:text-surface-400 border-b border-surface-100 dark:border-surface-700">
                                            <th scope="col" className="py-2 pr-3 font-medium whitespace-nowrap">기관</th>
                                            <th scope="col" className="py-2 pr-3 font-medium whitespace-nowrap">판정</th>
                                            <th scope="col" className="py-2 pr-3 font-medium whitespace-nowrap">차량</th>
                                            <th scope="col" className="py-2 pr-3 font-medium whitespace-nowrap">실패</th>
                                            <th scope="col" className="py-2 pr-3 font-medium">필요한 조치</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.rows.map((row) => {
                                            const cfg = VERDICT_CONFIG[row.verdict];
                                            // 동기화 경로에 실제로 있는 게이트만 '조치 불필요'로 접는다.
                                            // 기관 status는 게이트가 아니므로 여기 넣지 않는다 —
                                            // 넣으면 진짜 고장이 화면에서 지워진다.
                                            const inert = !row.calendarEnabled || row.organizationStatus === '(문서없음)';
                                            return (
                                                <tr
                                                    key={`${row.organizationId}::${row.calendarId}`}
                                                    className="border-b border-surface-100 dark:border-surface-800 align-top"
                                                >
                                                    <td className="py-2 pr-3">
                                                        <p className="font-medium text-surface-700 dark:text-surface-300">
                                                            {row.organizationName}
                                                        </p>
                                                        <p className="text-surface-400 dark:text-surface-500 break-all">
                                                            {row.calendarId}
                                                        </p>
                                                        {row.organizationStatus !== 'approved' && (
                                                            <p className="text-surface-400 dark:text-surface-500">
                                                                기관 상태: {row.organizationStatus}
                                                            </p>
                                                        )}
                                                    </td>
                                                    <td className="py-2 pr-3 whitespace-nowrap">
                                                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full font-medium ${cfg.chipClass}`}>
                                                            {cfg.emoji} {cfg.label}
                                                        </span>
                                                    </td>
                                                    <td className="py-2 pr-3 text-surface-600 dark:text-surface-300 whitespace-nowrap">
                                                        {row.vehicleCount}대
                                                        {row.blockedVehicleCount > 0 && (
                                                            <span className="block text-red-600 dark:text-red-400">
                                                                영구중단 {row.blockedVehicleCount}대
                                                            </span>
                                                        )}
                                                        <span className="block text-surface-400 dark:text-surface-500">
                                                            {row.vehicleNames.slice(0, 3).join(', ')}
                                                            {row.vehicleNames.length > 3 && ` 외 ${row.vehicleNames.length - 3}대`}
                                                        </span>
                                                    </td>
                                                    <td className="py-2 pr-3 text-surface-600 dark:text-surface-300 whitespace-nowrap">
                                                        {row.maxFailCount}회
                                                    </td>
                                                    <td className="py-2 pr-3 text-surface-600 dark:text-surface-300">
                                                        {inert ? (
                                                            <span className="text-surface-400 dark:text-surface-500">
                                                                동기화가 돌지 않는 기관 — 조치 불필요
                                                                {!row.calendarEnabled && ' (캘린더 기능 OFF)'}
                                                                {row.organizationStatus === '(문서없음)' && ' (기관 문서 없음)'}
                                                            </span>
                                                        ) : (
                                                            cfg.action
                                                        )}
                                                        {row.detail && (row.verdict === 'error' || row.verdict === 'rate_limited') && (
                                                            <span className="block text-surface-400 dark:text-surface-500 break-all">
                                                                {row.detail}
                                                            </span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <p className="text-xs text-surface-500 dark:text-surface-400">
                                진단 대상이 없습니다 — 실패가 누적된 연동 차량이 없습니다.
                                {!includeHealthy && " 정상 차량까지 보려면 '정상 차량까지 포함'을 켜고 다시 실행하세요."}
                            </p>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
