interface VehicleEntry {
    id: string;
    displayName?: string;
    [key: string]: unknown;
}

interface MemberEntry {
    id: string;
    name?: string;
    email?: string;
    role?: string;
    [key: string]: unknown;
}

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
    vehicles: VehicleEntry[];
    members: MemberEntry[];
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
            {/* 기간 필터 */}
            <div className="flex items-center gap-2 mt-3">
                <span className="text-xs text-surface-400 whitespace-nowrap">기간</span>
                <input
                    type="date"
                    value={filters.startDate}
                    onChange={e => onFiltersChange({ ...filters, startDate: e.target.value })}
                    className="input text-sm flex-1"
                />
                <span className="text-surface-300">~</span>
                <input
                    type="date"
                    value={filters.endDate}
                    onChange={e => onFiltersChange({ ...filters, endDate: e.target.value })}
                    className="input text-sm flex-1"
                />
                {(filters.startDate || filters.endDate) && (
                    <button
                        onClick={() => onFiltersChange({ ...filters, startDate: '', endDate: '' })}
                        className="text-xs text-surface-400 hover:text-red-500 whitespace-nowrap"
                    >
                        초기화
                    </button>
                )}
            </div>
        </div>
    );
}
