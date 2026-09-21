import { useNavigate } from 'react-router-dom';
import type { DriveLog } from '../../../types/driveLog';
import { toDateOrNull } from '../../../lib/dateUtils';
import { formatStartDatePrefix } from '../../../lib/driveLogExportFields';

export interface DriveLogTableRowProps {
    log: DriveLog;
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

/**
 * 동승자 배지 — 인원수와 **이름**을 함께 보여준다.
 *
 * 이름(`passengerNames`)에는 직원뿐 아니라 직접 적어 넣은 이용자도 들어 있는데,
 * 목록이 인원수만 보여 주던 때에는 관리자 화면 어디에서도 그 이름을 볼 수 없었다.
 * 인원수는 운전자를 포함하므로 2명부터가 "동승자가 있는 운행"이다.
 */
function PassengerBadge({ count, names }: { count?: number; names?: string[] }) {
    const named = names?.length ?? 0;
    if ((count ?? 0) < 2 && named === 0) return null;
    // 이름이 인원수보다 많은 옛 기록이 있다(이름을 적어도 인원에 안 세던 때의 것).
    // 저장값을 그대로 찍으면 "1명 (김이용, 박이용)"처럼 자기모순으로 보인다.
    const total = Math.max(count ?? 0, named + 1);
    return (
        <span className="flex items-center gap-1 min-w-0 text-primary-500 dark:text-primary-400" title={named > 0 ? `동승자: ${names!.join(', ')}` : undefined}>
            <span className="whitespace-nowrap">👥 {total}명</span>
            {named > 0 && (
                <span className="truncate text-surface-500 dark:text-surface-400">({names!.join(', ')})</span>
            )}
        </span>
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

const GRID_COLUMNS = '80px 60px 60px 70px 100px 1fr 100px 96px 80px 76px';

export default function DriveLogTableRow({ log, deletingId, onDelete }: DriveLogTableRowProps) {
    const navigate = useNavigate();
    const logDate = toDateOrNull(log.timestamp);
    const date = logDate
        ? logDate.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
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
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-surface-500 dark:text-surface-400">
                    <span>{log.vehicleName}</span>
                    <span>·</span>
                    {/* 분관을 등록한 기관에서만 값이 있다 — 어디서 출발한 차인지 목록에서 바로 구분된다 */}
                    {log.startLocation && <span className="text-surface-400 dark:text-surface-500">🚩 {log.startLocation} →</span>}
                    <span>{log.destination || '-'}</span>
                    {(log.startTime || log.endTime) && (
                        <span className="text-surface-400 dark:text-surface-500">
                            ({formatStartDatePrefix(log)}{log.startTime || '?'} ~ {log.endTime || '?'})
                        </span>
                    )}
                    <PassengerBadge count={log.passengerCount} names={log.passengerNames} />
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
                    <p className="text-sm text-surface-600 dark:text-surface-400 truncate" title={log.startLocation ? `${log.startLocation} → ${log.destination || '-'}` : (log.destination || '')}>
                        {log.startLocation && <span className="text-xs text-surface-400 dark:text-surface-500">🚩 {log.startLocation} → </span>}
                        {log.destination || '-'}
                    </p>
                </div>
                <div>
                    <p className="text-xs font-mono text-surface-500 dark:text-surface-400">
                        {log.startKm?.toLocaleString()} → {log.endKm?.toLocaleString()}
                    </p>
                </div>
                <div className="text-center min-w-0" title={log.passengerNames?.length ? `동승자: ${log.passengerNames.join(', ')}` : undefined}>
                    <p className="text-xs text-surface-600 dark:text-surface-400">
                        {log.passengerCount ? Math.max(log.passengerCount, (log.passengerNames?.length ?? 0) + 1) : '-'}
                    </p>
                    {/* 이름은 칸에 적어 둔다 — 길면 잘리지만 전체는 툴팁으로 볼 수 있다 */}
                    {(log.passengerNames?.length ?? 0) > 0 && (
                        <p className="text-[10px] text-surface-400 dark:text-surface-500 truncate">
                            {log.passengerNames!.join(', ')}
                        </p>
                    )}
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
