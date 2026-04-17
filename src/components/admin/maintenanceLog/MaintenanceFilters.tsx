/**
 * MaintenanceFilters — 정비 기록 검색/필터 바
 */
import { memo } from 'react';
import { MAINTENANCE_TYPES } from '../../../hooks/useMaintenanceLog';
import type { Vehicle } from '../../../types/vehicle';

interface Filters {
    search: string;
    vehicleId: string;
    type: string;
    startDate: string;
    endDate: string;
}

interface Props {
    filters: Filters;
    setFilters: (filters: Filters) => void;
    vehicles: Vehicle[];
    resetFilters: () => void;
}

export default memo(function MaintenanceFilters({ filters, setFilters, vehicles, resetFilters }: Props) {
    const hasActiveFilter = filters.search || filters.vehicleId || filters.type || filters.startDate || filters.endDate;

    return (
        <div className="glass-card p-4 mb-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                    type="text"
                    value={filters.search}
                    onChange={e => setFilters({ ...filters, search: e.target.value })}
                    className="input"
                    placeholder="🔍 검색 (차량, 정비소, 메모)"
                />
                <select
                    value={filters.vehicleId}
                    onChange={e => setFilters({ ...filters, vehicleId: e.target.value })}
                    className="input"
                >
                    <option value="">전체 차량</option>
                    {vehicles.map(v => (
                        <option key={v.id} value={v.id}>{v.displayName}</option>
                    ))}
                </select>
                <select
                    value={filters.type}
                    onChange={e => setFilters({ ...filters, type: e.target.value })}
                    className="input"
                >
                    <option value="">전체 유형</option>
                    {MAINTENANCE_TYPES.map(t => (
                        <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                    ))}
                </select>
            </div>
            {/* 기간 필터 */}
            <div className="flex items-center gap-2 mt-3">
                <span className="text-xs text-surface-400 whitespace-nowrap">기간</span>
                <input
                    type="date"
                    value={filters.startDate}
                    onChange={e => setFilters({ ...filters, startDate: e.target.value })}
                    className="input text-sm flex-1"
                />
                <span className="text-surface-300">~</span>
                <input
                    type="date"
                    value={filters.endDate}
                    onChange={e => setFilters({ ...filters, endDate: e.target.value })}
                    className="input text-sm flex-1"
                />
                {hasActiveFilter && (
                    <button
                        onClick={resetFilters}
                        className="text-xs text-surface-400 hover:text-red-500 whitespace-nowrap"
                    >
                        초기화
                    </button>
                )}
            </div>
        </div>
    );
});
