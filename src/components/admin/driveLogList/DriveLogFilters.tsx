import type { Vehicle } from '../../../types/vehicle';
import type { User } from '../../../types/user';
import DateRangeSearch from '../DateRangeSearch';

interface Filters {
    vehicleId: string;
    driverUid: string;
    search: string;
    startDate: string;
    endDate: string;
}

export interface DriveLogFiltersProps {
    filters: Filters;
    onFiltersChange: (filters: Filters) => void;
    vehicles: Vehicle[];
    members: User[];
}

export default function DriveLogFilters({ filters, onFiltersChange, vehicles, members }: DriveLogFiltersProps) {
    return (
        <div className="glass-card p-4 mb-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                    type="text"
                    value={filters.search}
                    onChange={e => onFiltersChange({ ...filters, search: e.target.value })}
                    className="input"
                    placeholder="🔍 검색 (이름, 차량, 목적, 행선지)"
                />
                <select
                    value={filters.vehicleId}
                    onChange={e => onFiltersChange({ ...filters, vehicleId: e.target.value })}
                    className="input"
                >
                    <option value="">전체 차량</option>
                    {vehicles.map(v => (
                        <option key={v.id} value={v.id}>{v.displayName}</option>
                    ))}
                </select>
                <select
                    value={filters.driverUid}
                    onChange={e => onFiltersChange({ ...filters, driverUid: e.target.value })}
                    className="input"
                >
                    <option value="">전체 직원</option>
                    {members.map(m => (
                        <option key={m.id} value={m.id}>{m.name || m.email}</option>
                    ))}
                </select>
            </div>
            {/* 기간 필터 — [검색]을 눌러야 적용된다 */}
            <DateRangeSearch
                startDate={filters.startDate}
                endDate={filters.endDate}
                onSearch={(startDate, endDate) => onFiltersChange({ ...filters, startDate, endDate })}
            >
                {(filters.startDate || filters.endDate) && (
                    <button
                        type="button"
                        onClick={() => onFiltersChange({ ...filters, startDate: '', endDate: '' })}
                        className="text-xs text-surface-500 dark:text-surface-400 hover:text-red-500 dark:hover:text-red-400 whitespace-nowrap"
                    >
                        초기화
                    </button>
                )}
            </DateRangeSearch>
        </div>
    );
}
