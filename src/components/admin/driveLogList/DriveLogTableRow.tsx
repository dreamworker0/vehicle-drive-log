import { useNavigate } from 'react-router-dom';
import type { DriveLogEntry } from '../../../types/driveLog';

export interface DriveLogTableRowProps {
    log: DriveLogEntry;
    deletingId: string | null;
    onDelete: (logId: string, driverName: string) => void;
}

function EditButton({ onClick }: { onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className="p-1.5 rounded-lg text-surface-300 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors min-h-[48px]"
            title="수정 (운전자 변경 등)"
        >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
            </svg>
        </button>
    );
}

function DeleteButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className="p-1.5 rounded-lg text-surface-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50 min-h-[48px]"
            title="삭제"
        >
            {disabled ? (
                <span className="w-4 h-4 spinner block" />
            ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                </svg>
            )}
        </button>
    );
}

/** 공동 운전자 배지 (있을 때만 표시) */
function CoDriverBadge({ names }: { names?: string[] }) {
    if (!names || names.length === 0) return null;
    return (
        <span
            className="text-xs text-primary-500 dark:text-primary-400 whitespace-nowrap"
            title={`공동 운전자: ${names.join(', ')}`}
        >
            🤝 외 {names.length}인
        </span>
    );
}

const GRID_COLUMNS = '80px 60px 60px 70px 100px 1fr 100px 40px 80px 76px';

export default function DriveLogTableRow({ log, deletingId, onDelete }: DriveLogTableRowProps) {
    const navigate = useNavigate();
    const date = log.timestamp?.toDate
        ? log.timestamp.toDate().toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
        : '-';
    const distance = (log.endKm - log.startKm) || 0;
    const isDeleting = deletingId === log.id;
    const handleEdit = () => navigate('/employee/drive-log', { state: { editLog: log } });

    return (
        <div className="glass-card p-4 hover:shadow-glass-lg transition-all">
            {/* 모바일 */}
            <div className="sm:hidden">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-surface-900 dark:text-surface-100">{log.driverName || '(이름 없음)'}</span>
                        <CoDriverBadge names={log.coDriverNames} />
                        <span className="text-xs text-surface-400 dark:text-surface-500">{date}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <span className="font-bold text-primary-600 dark:text-primary-400">{distance.toLocaleString()} km</span>
                        <EditButton onClick={handleEdit} />
                        <DeleteButton onClick={() => onDelete(log.id, log.driverName || '')} disabled={isDeleting} />
                    </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-surface-500 dark:text-surface-400">
                    <span>{log.vehicleName}</span>
                    <span>·</span>
                    <span>{log.destination || '-'}</span>
                    {(log.startTime || log.endTime) && (
                        <span className="text-surface-400 dark:text-surface-500">({log.startTime || '?'} ~ {log.endTime || '?'})</span>
                    )}
                    {(log.passengerCount ?? 0) > 1 && (
                        <span className="text-primary-500 dark:text-primary-400">👥 {log.passengerCount}명</span>
                    )}
                </div>
            </div>

            {/* 데스크탑 */}
            <div className="hidden sm:grid gap-2 items-center" style={{ gridTemplateColumns: GRID_COLUMNS }}>
                <div>
                    <p className="text-sm text-surface-900 dark:text-surface-100">{date}</p>
                </div>
                <div>
                    <p className="text-xs font-mono text-surface-500 dark:text-surface-400">{log.startTime || '-'}</p>
                </div>
                <div>
                    <p className="text-xs font-mono text-surface-500 dark:text-surface-400">{log.endTime || '-'}</p>
                </div>
                <div className="min-w-0">
                    <p className="text-sm text-surface-900 dark:text-surface-100 truncate">{log.driverName || '(이름 없음)'}</p>
                    <CoDriverBadge names={log.coDriverNames} />
                </div>
                <div className="min-w-0">
                    <p className="text-sm text-surface-700 dark:text-surface-300 truncate">{log.vehicleName}</p>
                </div>
                <div className="min-w-0">
                    <p className="text-sm text-surface-600 dark:text-surface-400 truncate" title={log.destination || ''}>{log.destination || '-'}</p>
                </div>
                <div>
                    <p className="text-xs font-mono text-surface-500 dark:text-surface-400">
                        {log.startKm?.toLocaleString()} → {log.endKm?.toLocaleString()}
                    </p>
                </div>
                <div className="text-center">
                    <p className="text-xs text-surface-600 dark:text-surface-400">{log.passengerCount || '-'}</p>
                </div>
                <div className="text-right">
                    <span className="font-bold text-primary-600 dark:text-primary-400">{distance.toLocaleString()} km</span>
                </div>
                <div className="flex items-center justify-center gap-0.5">
                    <EditButton onClick={handleEdit} />
                    <DeleteButton onClick={() => onDelete(log.id, log.driverName || '')} disabled={isDeleting} />
                </div>
            </div>
        </div>
    );
}

export { GRID_COLUMNS };
