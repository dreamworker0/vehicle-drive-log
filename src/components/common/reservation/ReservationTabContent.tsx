/**
 * ReservationTabContent - 탭 네비게이션 + 예약내역/운행완료 콘텐츠
 */
import React, { memo } from 'react';
import VehicleTimelineBar from '../VehicleTimelineBar';
import type { Vehicle } from '../../../types/vehicle';
import type { Reservation } from '../../../types/reservation';

interface ReservationTabContentProps {
    sideTab: 'list' | 'completed';
    setSideTab: (tab: 'list' | 'completed') => void;
    activeRes: Reservation[];
    completedRes: Reservation[];
    sortedActiveVehicles: Vehicle[];
    selectedReservations: Reservation[];
    onSlotClick: (vehicleId: string, startTime: string, endTime: string) => void;
    isPastDate: boolean;
    isToday: boolean;
    onEdit: (res: Reservation) => void;
    onCancel: (id: string) => Promise<void>;
    user: { uid?: string; id?: string } | null;
    isAdmin: boolean;
    setShowForm: (show: boolean) => void;
}

export default memo(function ReservationTabContent({
    sideTab,
    setSideTab,
    activeRes,
    completedRes,
    sortedActiveVehicles,
    selectedReservations,
    onSlotClick,
    isPastDate,
    isToday,
    onEdit,
    onCancel,
    user,
    isAdmin,
    setShowForm,
}: ReservationTabContentProps) {
    return (
        <>
            {/* 탭 네비게이션: 예약내역 / 운행완료 */}
            <div className="flex border-b border-surface-200 dark:border-surface-600 mb-4">
                <button
                    onClick={() => setSideTab('list')}
                    className={`flex-1 pb-2 text-sm font-medium border-b-2 transition-colors ${sideTab === 'list'
                        ? 'border-primary-500 text-primary-600'
                        : 'border-transparent text-surface-400 hover:text-surface-600 dark:text-surface-400'
                        }`}
                >
                    예약내역
                    {activeRes.length > 0 && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-300 font-bold">
                            {activeRes.length}
                        </span>
                    )}
                </button>
                <button
                    onClick={() => setSideTab('completed')}
                    className={`flex-1 pb-2 text-sm font-medium border-b-2 transition-colors ${sideTab === 'completed'
                        ? 'border-primary-500 text-primary-600'
                        : 'border-transparent text-surface-400 hover:text-surface-600 dark:text-surface-400'
                        }`}
                >
                    운행완료
                    {completedRes.length > 0 && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-400 font-bold">
                            {completedRes.length}
                        </span>
                    )}
                </button>
            </div>

            {/* 예약내역 탭 */}
            {sideTab === 'list' && (
                <div className="animate-fade-in">
                    {/* 차량별 타임라인 바 */}
                    {sortedActiveVehicles.length > 0 && (
                        <VehicleTimelineBar
                            vehicles={sortedActiveVehicles}
                            reservations={selectedReservations.filter(r => r.status !== 'cancelled')}
                            onSlotClick={onSlotClick}
                            isPastDate={isPastDate}
                            isToday={isToday}
                            onEdit={onEdit}
                            onCancel={onCancel}
                            user={user}
                            isAdmin={isAdmin}
                            setShowForm={setShowForm}
                        />
                    )}

                    {activeRes.length === 0 && (
                        <div className="text-center py-8">
                            <div className="text-2xl mb-2">📋</div>
                            <p className="text-sm text-surface-400">예약 내역이 없습니다</p>
                        </div>
                    )}
                </div>
            )}

            {/* 운행완료 탭 */}
            {sideTab === 'completed' && (
                <div className="animate-fade-in">
                    {completedRes.length === 0 ? (
                        <div className="text-center py-8">
                            <div className="text-2xl mb-2">✅</div>
                            <p className="text-sm text-surface-400">운행 완료 내역이 없습니다</p>
                        </div>
                    ) : (
                        <div className="space-y-1.5">
                            {completedRes.map(res => (
                                <div key={res.id} className="p-3 rounded-xl bg-green-50/50 dark:bg-green-900/20 border border-green-100 dark:border-green-800/40">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 min-w-0 flex-1">
                                            <p className="font-medium text-sm text-surface-600 dark:text-surface-400">{res.vehicleName}</p>
                                            <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400 rounded-full font-medium whitespace-nowrap">운행 완료</span>
                                        </div>
                                        {(isAdmin || res.reservedByUid === user?.uid) && (
                                            <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                                <button
                                                    onClick={() => { onEdit(res); setShowForm(true); }}
                                                    className="text-xs leading-none py-0.5 text-primary-500 hover:underline whitespace-nowrap"
                                                >
                                                    수정
                                                </button>
                                                <button
                                                    onClick={() => onCancel(res.id)}
                                                    className="text-xs leading-none py-0.5 text-red-500 hover:underline whitespace-nowrap"
                                                >
                                                    취소
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    <p className="text-xs text-surface-400 mt-1">
                                        예약 {res.startTime} ~ {res.endTime}
                                        {(res.actualStartTime || res.actualEndTime) && (
                                            <span className="ml-2 text-green-600 dark:text-green-400 font-medium">
                                                → 실제 {res.actualStartTime || '?'} ~ {res.actualEndTime || '?'}
                                            </span>
                                        )}
                                    </p>
                                    <p className="text-xs text-surface-400">{res.reservedByName}{res.purpose ? ` · ${res.purpose}` : ''}{res.destination ? ` → ${res.destination}` : ''}</p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </>
    );
});
