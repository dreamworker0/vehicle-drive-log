import useDriveLogList from '../../hooks/useDriveLogList';
import { SkeletonBox, SkeletonTable } from '../common/Skeleton';
import DriveLogFilters from './driveLogList/DriveLogFilters';
import DriveLogTableRow, { GRID_COLUMNS } from './driveLogList/DriveLogTableRow';
import DriveLogExportBar from './driveLogList/DriveLogExportBar';

export default function DriveLogList() {
    const {
        logs, vehicles, members, loading, loadingMore, hasMore,
        filters, setFilters, filteredLogs, totalDistance,
        deletingId, includeHipass, setIncludeHipass, includePassengers, setIncludePassengers,
        dupState, dupResult,
        loadMore, handleDelete,
        handleDupScan, handleDupClean, handleDupCancel,
        handleExportExcel, handleExportPdf,
    } = useDriveLogList();

    if (loading) {
        return (
            <div className="max-w-4xl mx-auto animate-fade-in">
                <SkeletonBox className="h-7 w-28 mb-1" />
                <SkeletonBox className="h-4 w-40 mb-6" />
                <SkeletonTable rows={6} cols={5} />
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto animate-fade-in">
            <DriveLogExportBar
                filteredCount={filteredLogs.length}
                totalDistance={totalDistance}
                includeHipass={includeHipass}
                onIncludeHipassChange={setIncludeHipass}
                includePassengers={includePassengers}
                onIncludePassengersChange={setIncludePassengers}
                dupState={dupState}
                dupResult={dupResult}
                onDupScan={handleDupScan}
                onDupClean={handleDupClean}
                onDupCancel={handleDupCancel}
                onExportExcel={handleExportExcel}
                onExportPdf={handleExportPdf}
            />

            <DriveLogFilters
                filters={filters}
                onFiltersChange={setFilters}
                vehicles={vehicles}
                members={members}
            />

            {/* 목록 */}
            {filteredLogs.length === 0 ? (
                <div className="glass-card p-12 text-center">
                    <div className="text-4xl mb-3">📋</div>
                    <p className="text-surface-400 font-medium">
                        {logs.length === 0 ? '운행 기록이 없습니다' : '검색 결과가 없습니다'}
                    </p>
                </div>
            ) : (
                <div className="space-y-2">
                    {/* 헤더 (데스크탑) */}
                    <div className="hidden sm:grid gap-2 px-4 py-2 text-xs font-medium text-surface-400" style={{ gridTemplateColumns: GRID_COLUMNS }}>
                        <div>날짜</div>
                        <div>출발</div>
                        <div>도착</div>
                        <div>운전자</div>
                        <div>차량</div>
                        <div>목적지</div>
                        <div>출발/도착Km</div>
                        <div className="text-center">인원</div>
                        <div className="text-right">주행거리</div>
                        <div></div>
                    </div>

                    {filteredLogs.map(log => (
                        <DriveLogTableRow
                            key={log.id}
                            log={log}
                            deletingId={deletingId}
                            onDelete={handleDelete}
                        />
                    ))}
                </div>
            )}

            {/* 더보기 버튼 */}
            {hasMore && !loading && (
                <div className="text-center mt-6">
                    <button
                        onClick={loadMore}
                        disabled={loadingMore}
                        className="btn-secondary px-6 py-2 text-sm"
                    >
                        {loadingMore ? (
                            <span className="flex items-center gap-2">
                                <span className="w-4 h-4 spinner" />
                                불러오는 중...
                            </span>
                        ) : (
                            `더보기 (${logs.length}건 로드됨)`
                        )}
                    </button>
                </div>
            )}
        </div>
    );
}
