interface DupResult {
    deleteCount: number;
    duplicateGroups: number;
    totalLogs: number;
}

export interface DriveLogExportBarProps {
    filteredCount: number;
    totalDistance: number;
    includeHipass: boolean;
    onIncludeHipassChange: (value: boolean) => void;
    includePassengers?: boolean;
    onIncludePassengersChange?: (value: boolean) => void;
    dupState: 'idle' | 'scanning' | 'result' | 'cleaning';
    dupResult: DupResult | null;
    onDupScan: () => void;
    onDupClean: () => void;
    onDupCancel: () => void;
    onExportExcel: () => void;
    onExportPdf: () => void;
}

export default function DriveLogExportBar({
    filteredCount,
    totalDistance,
    includeHipass,
    onIncludeHipassChange,
    includePassengers = false,
    onIncludePassengersChange,
    dupState,
    dupResult,
    onDupScan,
    onDupClean,
    onDupCancel,
    onExportExcel,
    onExportPdf,
}: DriveLogExportBarProps) {
    return (
        <>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">운행일지</h1>
                    <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">
                        {filteredCount}건 · 총 {totalDistance.toLocaleString()} km
                    </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <label className="flex items-center gap-1.5 text-xs text-surface-500 dark:text-surface-400 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={includeHipass}
                            onChange={e => onIncludeHipassChange(e.target.checked)}
                            className="rounded border-surface-300 dark:border-surface-600 text-primary-600 dark:text-primary-500 focus:ring-primary-500 w-3.5 h-3.5"
                        />
                        하이패스 포함
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-surface-500 dark:text-surface-400 cursor-pointer select-none mr-2">
                        <input
                            type="checkbox"
                            checked={includePassengers}
                            onChange={e => onIncludePassengersChange?.(e.target.checked)}
                            className="rounded border-surface-300 dark:border-surface-600 text-primary-600 dark:text-primary-500 focus:ring-primary-500 w-3.5 h-3.5"
                        />
                        동행자 포함
                    </label>
                    <button
                        onClick={onDupScan}
                        disabled={dupState === 'scanning' || dupState === 'cleaning'}
                        className="btn-secondary btn-sm flex items-center gap-2 disabled:opacity-50 min-h-[48px]"
                    >
                        {dupState === 'scanning' ? (
                            <span className="w-4 h-4 spinner" />
                        ) : (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                            </svg>
                        )}
                        {dupState === 'scanning' ? '검사 중...' : '중복 검사'}
                    </button>
                    <button
                        onClick={onExportExcel}
                        disabled={filteredCount === 0}
                        className="btn-secondary btn-sm flex items-center gap-2 disabled:opacity-50 min-h-[48px]"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                        </svg>
                        엑셀
                    </button>
                    <button
                        onClick={onExportPdf}
                        disabled={filteredCount === 0}
                        className="btn-primary btn-sm flex items-center gap-2 disabled:opacity-50 min-h-[48px]"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                        </svg>
                        PDF
                    </button>
                </div>
            </div>

            {/* 중복 탐지 결과 배너 */}
            {(dupState === 'result' || dupState === 'cleaning') && dupResult && (
                <div className="glass-card p-4 mb-4 border border-amber-200 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-900/20">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <span className="text-2xl">⚠️</span>
                            <div>
                                <p className="font-semibold text-surface-900 dark:text-surface-100">
                                    중복 {dupResult.duplicateGroups}개 그룹, <span className="text-red-600 dark:text-red-400">{dupResult.deleteCount}건</span> 삭제 예정
                                </p>
                                <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
                                    총 {dupResult.totalLogs}건 중 가장 먼저 생성된 1건만 남기고 나머지를 삭제합니다.
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={onDupCancel}
                                className="btn-secondary btn-sm min-h-[48px]"
                            >
                                취소
                            </button>
                            <button
                                onClick={onDupClean}
                                disabled={dupState === 'cleaning'}
                                className="btn-sm flex items-center gap-2 disabled:opacity-50 bg-red-600 dark:bg-red-700 hover:bg-red-700 dark:hover:bg-red-800 text-white rounded-lg px-3 py-1.5 text-sm font-medium transition-colors min-h-[48px]"
                            >
                                {dupState === 'cleaning' ? (
                                    <><span className="w-4 h-4 spinner" /> 정리 중...</>
                                ) : '정리 실행'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
