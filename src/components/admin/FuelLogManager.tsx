/**
 * FuelLogManager — 관리자용 주유 기록 관리 페이지
 * MaintenanceLog.tsx 패턴 기반
 */
import useFuelLogAdmin from '../../hooks/useFuelLogAdmin';
import { useToast } from '../../hooks/useToast';
import useAdminLogExport from '../../hooks/useAdminLogExport';
import { formatTimestampTime } from '../../lib/dateUtils';
import { SkeletonBox, SkeletonList } from '../common/Skeleton';
import LogExportButtons from './LogExportButtons';

export default function FuelLogManager() {
    const {
        vehicles, loading,
        filters, setFilters, resetFilters,
        filteredRecords, totalCost, totalAmount,
        handleDelete,
    } = useFuelLogAdmin();
    const { showToast } = useToast();
    const { orgName, approvalLine, runExcel, runPdf } = useAdminLogExport();

    if (loading) {
        return (
            <div className="max-w-4xl mx-auto animate-fade-in">
                <SkeletonBox className="h-7 w-36 mb-1" />
                <SkeletonBox className="h-4 w-24 mb-6" />
                <SkeletonList count={4} />
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto animate-fade-in">
            {/* 헤더 */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">주유일지</h1>
                    <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">
                        {filteredRecords.length}건
                        {totalAmount > 0 && ` · ${totalAmount.toLocaleString()}L`}
                        {totalCost > 0 && ` · 총 ${totalCost.toLocaleString()}원`}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <LogExportButtons
                        disabled={filteredRecords.length === 0}
                        onExcel={() => runExcel(async () => {
                            const { downloadFuelLogsExcel } = await import('../../lib/excelExport');
                            await downloadFuelLogsExcel(filteredRecords, `주유기록_${orgName || '전체'}`, {
                                onError: (msg) => showToast(msg, 'warning'),
                            });
                        })}
                        onPdf={() => runPdf(async () => {
                            const { downloadFuelLogPdf } = await import('../../lib/pdf/fuelLogPdfExport');
                            downloadFuelLogPdf(filteredRecords, {
                                orgName,
                                approvalLine,
                                onError: (msg) => showToast(msg, 'error'),
                            });
                        })}
                    />
                </div>
            </div>

            {/* 검색/필터 바 */}
            <div className="glass-card p-4 mb-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                        type="text"
                        value={filters.search}
                        onChange={e => setFilters({ ...filters, search: e.target.value })}
                        className="input min-h-[48px]"
                        placeholder="🔍 검색 (차량, 주유원)"
                    />
                    <select
                        value={filters.vehicleId}
                        onChange={e => setFilters({ ...filters, vehicleId: e.target.value })}
                        className="input min-h-[48px]"
                    >
                        <option value="">전체 차량</option>
                        {vehicles.map(v => (
                            <option key={v.id} value={v.id}>{v.displayName}</option>
                        ))}
                    </select>
                </div>
                <div className="flex items-center gap-2 mt-3">
                    <span className="text-xs text-surface-400 whitespace-nowrap">기간</span>
                    <input
                        type="date"
                        value={filters.startDate}
                        onChange={e => setFilters({ ...filters, startDate: e.target.value })}
                        className="input text-sm flex-1 min-h-[48px]"
                    />
                    <span className="text-surface-300">~</span>
                    <input
                        type="date"
                        value={filters.endDate}
                        onChange={e => setFilters({ ...filters, endDate: e.target.value })}
                        className="input text-sm flex-1 min-h-[48px]"
                    />
                    {(filters.search || filters.vehicleId || filters.startDate || filters.endDate) && (
                        <button
                            onClick={resetFilters}
                            className="text-xs text-surface-400 hover:text-red-500 whitespace-nowrap min-h-[48px]"
                        >
                            초기화
                        </button>
                    )}
                </div>
            </div>

            {/* 기록 목록 */}
            {filteredRecords.length === 0 ? (
                <div className="glass-card p-12 text-center">
                    <div className="text-4xl mb-3">⛽</div>
                    <p className="text-surface-400 dark:text-surface-500 font-medium">주유 기록이 없습니다</p>
                    <p className="text-sm text-surface-300 dark:text-surface-600 mt-1">직원이 주유 탭에서 기록을 등록하면 여기에 표시됩니다</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {/* 헤더 (데스크탑) */}
                    <div className="hidden sm:grid gap-2 px-4 py-2 text-xs font-medium text-surface-400 dark:text-surface-500" style={{ gridTemplateColumns: '2fr 1fr 1.5fr 2fr 1.2fr 1.5fr 1.2fr 40px' }}>
                        <div>날짜</div>
                        <div>시각</div>
                        <div>주유원</div>
                        <div>차량</div>
                        <div className="text-right">주유량</div>
                        <div className="text-right">금액</div>
                        <div className="text-right">주행거리</div>
                        <div></div>
                    </div>

                    {filteredRecords.map(rec => {
                        const dateStr = rec.date || '-';
                        const timeStr = formatTimestampTime(rec.createdAt, { hour12: false });
                        return (
                            <div key={rec.id} className="glass-card p-4 hover:shadow-glass-lg transition-all">
                                {/* 모바일 */}
                                <div className="sm:hidden">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-sm text-surface-900 dark:text-surface-100">{rec.driverName}</span>
                                            <span className="text-xs text-surface-400 dark:text-surface-500">{dateStr} {timeStr}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-emerald-600 dark:text-emerald-400">{rec.fuelAmount}{rec.fuelType === 'electric' ? 'kWh' : 'L'}</span>
                                            <button
                                                onClick={() => handleDelete(rec)}
                                                className="p-1.5 rounded-lg text-surface-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors min-h-[48px] min-w-[48px] flex items-center justify-center"
                                                title="삭제"
                                            >
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-surface-500 dark:text-surface-400">
                                        <span>{rec.vehicleName}</span>
                                        <span>·</span>
                                        <span>{rec.fuelCost?.toLocaleString()}원</span>
                                        {rec.meterReading && (
                                            <>
                                                <span>·</span>
                                                <span>{rec.meterReading.toLocaleString()} km</span>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* 데스크탑 */}
                                <div className="hidden sm:grid gap-2 items-center" style={{ gridTemplateColumns: '2fr 1fr 1.5fr 2fr 1.2fr 1.5fr 1.2fr 40px' }}>
                                    <div>
                                        <p className="text-sm text-surface-900 dark:text-surface-100">{dateStr}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs font-mono text-surface-500 dark:text-surface-400">{timeStr || '-'}</p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-surface-900 dark:text-surface-100 truncate">{rec.driverName}</p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-surface-700 dark:text-surface-300 truncate">{rec.vehicleName}</p>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{rec.fuelAmount}{rec.fuelType === 'electric' ? 'kWh' : 'L'}</span>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-sm text-surface-700 dark:text-surface-300">{rec.fuelCost?.toLocaleString()}원</span>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-xs font-mono text-surface-500 dark:text-surface-400">{rec.meterReading?.toLocaleString() || '-'} km</span>
                                    </div>
                                    <div className="text-center">
                                        <button
                                            onClick={() => handleDelete(rec)}
                                            className="p-1.5 rounded-lg text-surface-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors min-h-[48px] min-w-[48px] flex items-center justify-center"
                                            title="삭제"
                                        >
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
