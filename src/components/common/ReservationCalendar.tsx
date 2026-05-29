/**
 * ReservationCalendar — 차량 예약 캘린더
 * 로직은 useReservationCalendar 훅으로 분리, UI는 CalendarGrid + ReservationSidePanel 사용
 */
import { useCallback } from 'react';
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
    } = useReservationCalendar({ isAdmin });
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
            <h1 className={`font-bold text-surface-900 dark:text-surface-100 ${isAdmin ? 'text-2xl mb-6' : 'text-lg mb-2'}`}>차량 예약</h1>

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
