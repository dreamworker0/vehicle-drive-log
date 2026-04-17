/**
 * MaintenanceRecordCard — 개별 정비 기록 카드
 */
import { memo } from 'react';
import { VEHICLE_TYPE_ICONS } from '../../../lib/constants';
import type { MaintenanceRecord } from '../../../types/maintenance';

/** filteredRecords에서 vehicleType이 추가된 확장 타입 */
type RecordWithVehicleType = MaintenanceRecord & { vehicleType: string | null };

interface TypeInfo {
    icon: string;
    label: string;
}

interface Props {
    record: RecordWithVehicleType;
    getTypeInfo: (type: string) => TypeInfo;
    onEdit: (record: MaintenanceRecord) => void;
    onDelete: (record: MaintenanceRecord) => void;
}

export default memo(function MaintenanceRecordCard({ record, getTypeInfo, onEdit, onDelete }: Props) {
    const typeInfo = getTypeInfo(record.type);
    const vehicleIcon = record.vehicleType ? (VEHICLE_TYPE_ICONS[record.vehicleType] || '🚗') : '🚗';

    return (
        <div className="glass-card p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center text-xl flex-shrink-0">
                {vehicleIcon}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="font-bold text-surface-900 dark:text-surface-100">{record.vehicleName}</span>
                    <span className="text-xs px-2 py-0.5 bg-surface-100 dark:bg-surface-700 rounded-full text-surface-500 dark:text-surface-400">{typeInfo.icon} {typeInfo.label}</span>
                </div>
                <p className="text-xs text-surface-400 mt-0.5">
                    {record.date}{record.shop && ` · ${record.shop}`}{record.km && ` · ${record.km.toLocaleString()} km`}
                </p>
                {record.description && <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">{record.description}</p>}
                {(record.nextDueKm || record.nextDueDate) && (
                    <p className="text-xs text-amber-600 mt-1">
                        📅 다음: {record.nextDueDate || ''} {record.nextDueKm ? `${record.nextDueKm.toLocaleString()} km` : ''}
                    </p>
                )}
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
                {record.blockVehicle && (
                    <span className="text-xs px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-full font-medium">🚫 차단</span>
                )}
                {record.cost && <span className="text-sm font-bold text-surface-700 dark:text-surface-300">{record.cost.toLocaleString()}원</span>}
                <div className="flex items-center gap-1 mt-1">
                    <button
                        onClick={() => onEdit(record)}
                        title="수정"
                        className="p-1.5 rounded-lg text-surface-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-all"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                        </svg>
                    </button>
                    <button
                        onClick={() => onDelete(record)}
                        title="삭제"
                        className="p-1.5 rounded-lg text-surface-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
});
