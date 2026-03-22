/**
 * DailyLogView — 일별일지 조회 컴포넌트
 * 날짜 + 차량 선택 → 운행/주유 데이터 조회 → 요약 + 테이블 표시 → PDF 다운로드
 */
import useDailyLog from '../../hooks/useDailyLog';
import { useToast } from '../../hooks/useToast';
import { SkeletonBox } from '../common/Skeleton';

export default function DailyLogView() {
    const { showToast } = useToast();
    const {
        selectedDate, setSelectedDate,
        selectedVehicleId, setSelectedVehicleId,
        vehicles, org, selectedVehicle,
        driveLogs, fuelLogs,
        loading, loadingData,
        summary,
    } = useDailyLog();

    const handlePdfDownload = async () => {
        const { downloadDailyLogPdf } = await import('../../lib/dailyLogPdfExport');
        const defaultApproval = [{ title: '담당' }, { title: '팀장' }];
        const useApproval = org?.hideApprovalLine
            ? []
            : ((org?.approvalLine?.length ?? 0) > 0 ? org!.approvalLine : defaultApproval);

        downloadDailyLogPdf(driveLogs, fuelLogs, {
            orgName: org?.name || '',
            vehicleName: selectedVehicle?.displayName || selectedVehicle?.name || '',
            date: selectedDate,
            todayDistance: summary.todayDistance,
            previousEndKm: summary.previousEndKm,
            todayEndKm: summary.todayEndKm,
            approvalLine: useApproval,
            onError: (msg) => showToast(msg, 'error'),
        });
    };

    if (loading) {
        return (
            <div className="space-y-4">
                <SkeletonBox className="h-10 w-full" />
                <SkeletonBox className="h-32 w-full" />
                <SkeletonBox className="h-48 w-full" />
            </div>
        );
    }

    return (
        <div className="space-y-4 animate-fade-in">
            {/* 필터: 날짜 + 차량 + PDF */}
            <div className="glass-card p-4">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
                    <div className="flex-1">
                        <label className="block text-xs font-medium text-surface-500 dark:text-surface-400 mb-1">
                            날짜
                        </label>
                        <input
                            type="date"
                            value={selectedDate}
                            onChange={e => setSelectedDate(e.target.value)}
                            className="input w-full"
                        />
                    </div>
                    <div className="flex-1">
                        <label className="block text-xs font-medium text-surface-500 dark:text-surface-400 mb-1">
                            차량
                        </label>
                        <select
                            value={selectedVehicleId}
                            onChange={e => setSelectedVehicleId(e.target.value)}
                            className="input w-full"
                        >
                            {vehicles.length === 0 && <option value="">차량 없음</option>}
                            {vehicles.map(v => (
                                <option key={v.id} value={v.id}>
                                    {v.displayName || v.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <button
                        onClick={handlePdfDownload}
                        disabled={driveLogs.length === 0 || loadingData}
                        className="btn-primary btn-sm flex items-center gap-2 disabled:opacity-50 whitespace-nowrap h-[42px]"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                        </svg>
                        PDF
                    </button>
                </div>
            </div>

            {/* 로딩 */}
            {loadingData && (
                <div className="flex items-center justify-center py-8">
                    <div className="w-6 h-6 spinner" />
                </div>
            )}

            {/* 데이터 없음 */}
            {!loadingData && driveLogs.length === 0 && (
                <div className="glass-card p-12 text-center">
                    <div className="text-4xl mb-3">📋</div>
                    <p className="text-surface-900 dark:text-surface-100 font-medium mb-1">운행 기록 없음</p>
                    <p className="text-sm text-surface-400">
                        {selectedDate} · {selectedVehicle?.displayName || '차량 미선택'} — 해당 날짜에 기록이 없습니다
                    </p>
                </div>
            )}

            {/* 데이터 있음 */}
            {!loadingData && driveLogs.length > 0 && (
                <>
                    {/* 운행상황 요약 카드 */}
                    <div className="glass-card p-4">
                        <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-3 flex items-center gap-2">
                            <svg className="w-4 h-4 text-primary-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
                            </svg>
                            운행 상황
                        </h3>
                        <div className="grid grid-cols-3 gap-3">
                            <div className="bg-surface-50 dark:bg-surface-800/50 rounded-lg p-3 text-center">
                                <p className="text-xs text-surface-400 mb-1">금일 운행거리</p>
                                <p className="text-lg font-bold text-primary-600 dark:text-primary-400">
                                    {summary.todayDistance.toLocaleString()}
                                    <span className="text-xs font-normal ml-0.5">km</span>
                                </p>
                            </div>
                            <div className="bg-surface-50 dark:bg-surface-800/50 rounded-lg p-3 text-center">
                                <p className="text-xs text-surface-400 mb-1">전일 누계</p>
                                <p className="text-lg font-bold text-surface-700 dark:text-surface-200">
                                    {summary.previousEndKm !== null ? summary.previousEndKm.toLocaleString() : '-'}
                                    <span className="text-xs font-normal ml-0.5">km</span>
                                </p>
                            </div>
                            <div className="bg-surface-50 dark:bg-surface-800/50 rounded-lg p-3 text-center">
                                <p className="text-xs text-surface-400 mb-1">금일 누계</p>
                                <p className="text-lg font-bold text-surface-700 dark:text-surface-200">
                                    {summary.todayEndKm !== null ? summary.todayEndKm.toLocaleString() : '-'}
                                    <span className="text-xs font-normal ml-0.5">km</span>
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* 주유 정보 (있을 때만) */}
                    {fuelLogs.length > 0 && (
                        <div className="glass-card p-4">
                            <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-3 flex items-center gap-2">
                                <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 11.25V4.875A2.625 2.625 0 0 0 12.375 2.25h-4.75A2.625 2.625 0 0 0 5 4.875V18.75a2.25 2.25 0 0 0 2.25 2.25h5.5A2.25 2.25 0 0 0 15 18.75v-3" />
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 8.25h1.5a2.25 2.25 0 0 1 2.25 2.25v3a1.5 1.5 0 0 0 3 0V7.5l-2.25-3" />
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 9h9.5" />
                                </svg>
                                주유 정보
                            </h3>
                            <div className="space-y-2">
                                {fuelLogs.map((fuel: any, idx: number) => (
                                    <div key={idx} className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                                        <div className="bg-surface-50 dark:bg-surface-800/50 rounded-lg px-3 py-2">
                                            <span className="text-xs text-surface-400">주유원</span>
                                            <p className="font-medium text-surface-900 dark:text-surface-100">{fuel.driverName || '-'}</p>
                                        </div>
                                        <div className="bg-surface-50 dark:bg-surface-800/50 rounded-lg px-3 py-2">
                                            <span className="text-xs text-surface-400">주유미터</span>
                                            <p className="font-medium text-surface-900 dark:text-surface-100">{fuel.meterReading?.toLocaleString() || '-'} km</p>
                                        </div>
                                        <div className="bg-surface-50 dark:bg-surface-800/50 rounded-lg px-3 py-2">
                                            <span className="text-xs text-surface-400">주유량</span>
                                            <p className="font-medium text-surface-900 dark:text-surface-100">{fuel.fuelAmount || '-'} ℓ</p>
                                        </div>
                                        <div className="bg-surface-50 dark:bg-surface-800/50 rounded-lg px-3 py-2">
                                            <span className="text-xs text-surface-400">주유금액</span>
                                            <p className="font-medium text-surface-900 dark:text-surface-100">{fuel.fuelCost?.toLocaleString() || '-'} 원</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* 운행 기록 테이블 */}
                    <div className="glass-card overflow-hidden">
                        <div className="px-4 py-3 border-b border-surface-200 dark:border-surface-700">
                            <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300 flex items-center gap-2">
                                <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                                </svg>
                                운행 기록 ({driveLogs.length}건)
                            </h3>
                        </div>

                        {/* 모바일 카드 뷰 */}
                        <div className="sm:hidden divide-y divide-surface-100 dark:divide-surface-700">
                            {driveLogs.map((log: any, idx: number) => {
                                const distance = (log.endKm || 0) - (log.startKm || 0);
                                return (
                                    <div key={idx} className="p-4">
                                        <div className="flex items-center justify-between mb-1.5">
                                            <span className="font-medium text-sm text-surface-900 dark:text-surface-100">
                                                {log.driverName || '(이름 없음)'}
                                            </span>
                                            <span className="font-bold text-primary-600 dark:text-primary-400">
                                                {distance > 0 ? `${distance.toLocaleString()} km` : '-'}
                                            </span>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-surface-500 dark:text-surface-400">
                                            {log.destination && <span>{log.destination}</span>}
                                            {log.purpose && <span>· {log.purpose}</span>}
                                            {(log.startTime || log.endTime) && (
                                                <span>· {log.startTime || '?'}~{log.endTime || '?'}</span>
                                            )}
                                            {log.passengers > 0 && (
                                                <span className="text-primary-500">· 👥 {log.passengers}명</span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* 데스크탑 테이블 */}
                        <div className="hidden sm:block overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-xs text-surface-400 border-b border-surface-200 dark:border-surface-700">
                                        <th className="px-4 py-2 text-left font-medium">사용자</th>
                                        <th className="px-2 py-2 text-center font-medium w-14">인원</th>
                                        <th className="px-3 py-2 text-left font-medium">용무</th>
                                        <th className="px-3 py-2 text-left font-medium">목적지</th>
                                        <th className="px-3 py-2 text-center font-medium w-24">운행 시간</th>
                                        <th className="px-3 py-2 text-right font-medium w-20">거리(km)</th>
                                        <th className="px-3 py-2 text-right font-medium w-24">누계(km)</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
                                    {driveLogs.map((log: any, idx: number) => {
                                        const distance = (log.endKm || 0) - (log.startKm || 0);
                                        const timeStr = (log.startTime && log.endTime)
                                            ? `${log.startTime}~${log.endTime}`
                                            : (log.startTime || log.endTime || '-');
                                        return (
                                            <tr key={idx} className="hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors">
                                                <td className="px-4 py-2.5 text-surface-900 dark:text-surface-100 font-medium">
                                                    {log.driverName || '-'}
                                                </td>
                                                <td className="px-2 py-2.5 text-center text-surface-600 dark:text-surface-400">
                                                    {log.passengers || '-'}
                                                </td>
                                                <td className="px-3 py-2.5 text-surface-600 dark:text-surface-400">
                                                    {log.purpose || '-'}
                                                </td>
                                                <td className="px-3 py-2.5 text-surface-600 dark:text-surface-400">
                                                    {log.destination || '-'}
                                                </td>
                                                <td className="px-3 py-2.5 text-center text-surface-500 dark:text-surface-400 font-mono text-xs">
                                                    {timeStr}
                                                </td>
                                                <td className="px-3 py-2.5 text-right font-bold text-primary-600 dark:text-primary-400">
                                                    {distance > 0 ? distance.toLocaleString() : '-'}
                                                </td>
                                                <td className="px-3 py-2.5 text-right text-surface-500 dark:text-surface-400 font-mono text-xs">
                                                    {log.endKm ? log.endKm.toLocaleString() : '-'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                {/* 소계 */}
                                <tfoot>
                                    <tr className="bg-surface-50 dark:bg-surface-800/70 border-t border-surface-300 dark:border-surface-600">
                                        <td colSpan={5} className="px-4 py-2 text-xs font-semibold text-surface-500 dark:text-surface-400 text-center">
                                            소 계
                                        </td>
                                        <td className="px-3 py-2 text-right font-bold text-primary-600 dark:text-primary-400">
                                            {summary.todayDistance.toLocaleString()}
                                        </td>
                                        <td className="px-3 py-2 text-right text-surface-500 dark:text-surface-400 font-mono text-xs">
                                            {summary.todayEndKm ? summary.todayEndKm.toLocaleString() : '-'}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
