/**
 * ReservationCalendar — 차량 예약 캘린더
 * 로직은 useReservationCalendar 훅으로 분리, UI는 CalendarGrid + ReservationSidePanel 사용
 */
import { useCallback } from 'react';
import { format } from 'date-fns';
import useReservationCalendar from '../../hooks/useReservationCalendar';
import useVehiclePriority from '../../hooks/useVehiclePriority';
import { useReservationPattern } from '../../hooks/useReservationPattern';
import CalendarGrid from './CalendarGrid';
import ReservationSidePanel from './ReservationSidePanel';
import PendingReservationList from '../admin/PendingReservationList';

interface Props {
    isAdmin?: boolean;
}

export default function ReservationCalendar({ isAdmin = false }: Props) {
    const {
        vehicles, loading, form, setForm,
        selectedDate, showForm, setShowForm,
        sideTab, setSideTab,
        submitting, editingReservation, editingGroupId, editingRecurringGroupId,
        favorites, routeInfo, routeLoading, freeRoadRoute, freeRoadLoading, handleFetchFreeRoad,
        showFavSave, setShowFavSave,
        favName, setFavName,
        calendarDays, monthLabel, todayStr,
        selectedReservations, isPastDate, isToday,
        user, members,
        prevMonth, nextMonth,
        handleDateSelect,
        handleSubmit, handleEdit, handleCancel, handleSaveFavorite, handleOpenForm,
        getCurrentTimeStr, getMinStartTime,
        getNavigationDeeplink,
        holidays, reservations,
        syncNow, syncing, lastSyncAt,
    } = useReservationCalendar({ isAdmin });

    // 구글 캘린더 연동 차량이 하나라도 있을 때만 동기화 컨트롤 노출
    const hasCalendarLinkedVehicle = vehicles.some(v => v.googleCalendarId && v.googleCalendarId.includes('@'));
    const { usageCounts } = useVehiclePriority();
    const { recentDestinations } = useReservationPattern();

    const handleSlotClick = useCallback((vehicleId: string, startTime: string, endTime: string) => {
        setForm(prev => ({ ...prev, vehicleId, startTime, endTime }));
        setShowForm(true);
    }, [setForm, setShowForm]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 spinner" />
            </div>
        );
    }

    return (
        <div className={`${isAdmin ? 'max-w-4xl' : 'max-w-lg'} mx-auto animate-fade-in`}>
            <div className={`flex items-center justify-between gap-2 ${isAdmin ? 'mb-6' : 'mb-2'}`}>
                <h1 className={`font-bold text-surface-900 dark:text-surface-100 ${isAdmin ? 'text-2xl' : 'text-lg'}`}>차량 예약</h1>
                {hasCalendarLinkedVehicle && (
                    <div className="flex items-center gap-2 text-xs text-surface-500 dark:text-surface-400">
                        <span>
                            {lastSyncAt ? `마지막 동기화 ${format(lastSyncAt, 'HH:mm')}` : '동기화 이력 없음'}
                        </span>
                        <button
                            type="button"
                            onClick={syncNow}
                            disabled={syncing}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg font-medium text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20 hover:bg-primary-100 dark:hover:bg-primary-900/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            aria-label="구글 캘린더 지금 동기화"
                        >
                            {syncing ? (
                                <span className="w-3.5 h-3.5 spinner" aria-hidden="true" />
                            ) : (
                                <span aria-hidden="true">🔄</span>
                            )}
                            {syncing ? '동기화 중…' : '지금 동기화'}
                        </button>
                    </div>
                )}
            </div>

            {isAdmin && <PendingReservationList />}

            <div className="space-y-4">
                {/* 달력 */}
                <div>
                    <CalendarGrid
                        calendarDays={calendarDays}
                        selectedDate={selectedDate}
                        todayStr={todayStr}
                        monthLabel={monthLabel}
                        onDateSelect={handleDateSelect}
                        onPrevMonth={prevMonth}
                        onNextMonth={nextMonth}
                    />
                </div>

                {/* 사이드 패널 */}
                <div>
                    <ReservationSidePanel
                        selectedDate={selectedDate}
                        sideTab={sideTab}
                        setSideTab={setSideTab}
                        showForm={showForm}
                        setShowForm={setShowForm}
                        form={form}
                        setForm={setForm}
                        vehicles={vehicles}
                        favorites={favorites}
                        selectedReservations={selectedReservations}
                        isPastDate={isPastDate}
                        isToday={isToday}
                        submitting={submitting}
                        editingReservation={editingReservation}
                        editingGroupId={editingGroupId}
                        routeInfo={routeInfo}
                        routeLoading={routeLoading}
                        freeRoadRoute={freeRoadRoute}
                        freeRoadLoading={freeRoadLoading}
                        onFetchFreeRoad={handleFetchFreeRoad}
                        user={user!}
                        isAdmin={isAdmin}
                        members={members}
                        getCurrentTimeStr={getCurrentTimeStr}
                        getMinStartTime={getMinStartTime}
                        getNavigationDeeplink={getNavigationDeeplink}
                        onSubmit={handleSubmit}
                        onEdit={handleEdit}
                        onCancel={handleCancel}
                        showFavSave={showFavSave}
                        setShowFavSave={setShowFavSave}
                        favName={favName}
                        setFavName={setFavName}
                        onSaveFavorite={handleSaveFavorite}
                        onOpenForm={handleOpenForm}
                        usageCounts={usageCounts}
                        recentDestinations={recentDestinations}
                        holidays={holidays}
                        allReservations={reservations}
                        editingRecurringGroupId={editingRecurringGroupId}
                        onSlotClick={handleSlotClick}
                    />
                </div>
            </div>
        </div>
    );
}
