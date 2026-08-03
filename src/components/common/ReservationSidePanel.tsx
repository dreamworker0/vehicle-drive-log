/**
 * ReservationSidePanel — 예약 사이드 패널 (예약 폼 + 예약 목록)
 * ReservationCalendar에서 추출된 서브 컴포넌트
 */
import React, { useRef, useMemo } from 'react';
import { calcEndTime } from '../../hooks/utils/reservationUtils';
import { generateRecurringDates } from '../../hooks/utils/recurringUtils';
import VehicleSelector from './reservation/VehicleSelector';
import DestinationInput from './reservation/DestinationInput';
import RouteInfoPanel from './reservation/RouteInfoPanel';
import RecurringReservationPanel from './reservation/RecurringReservationPanel';
import ReservationTabContent from './reservation/ReservationTabContent';
import ReservationTypeSelector from './reservation/ReservationTypeSelector';
import type { Vehicle } from '../../types/vehicle';
import type { Favorite } from '../../types/favorite';
import type { Reservation, ReservationForm } from '../../types/reservation';
import type { User as UserDoc } from '../../types/user';

interface Props {
    selectedDate: string;
    sideTab: 'list' | 'completed';
    setSideTab: (tab: 'list' | 'completed') => void;
    showForm: boolean;
    setShowForm: (show: boolean) => void;
    form: ReservationForm;
    setForm: React.Dispatch<React.SetStateAction<ReservationForm>>;
    vehicles: Vehicle[];
    favorites: Favorite[];
    selectedReservations: Reservation[];
    isPastDate: boolean;
    isToday: boolean;
    submitting: boolean;
    editingReservation: Reservation | null;
    editingGroupId?: string | null;
    routeInfo: { distance: number; duration: number; tollFee?: number; hasToll?: boolean; isMulti?: boolean } | null;
    routeLoading: boolean;
    freeRoadRoute?: { distance: number; duration: number; tollFee: number } | null;
    freeRoadLoading?: boolean;
    onFetchFreeRoad?: () => void;
    user: { uid?: string; id?: string } | null;
    isAdmin?: boolean;
    members?: UserDoc[];
    getCurrentTimeStr: () => string;
    getMinStartTime: () => string;
    getNavigationDeeplink: (dest: string) => string;
    onSubmit: (e: React.FormEvent) => Promise<void>;
    onEdit: (res: Reservation) => void;
    onCancel: (id: string) => Promise<void>;
    onSlotClick: (vehicleId: string, startTime: string, endTime: string) => void;
    showFavSave: boolean;
    setShowFavSave: (show: boolean) => void;
    favName: string;
    setFavName: (name: string) => void;
    onSaveFavorite: () => Promise<void>;
    onOpenForm: (defaultVehicleId?: string) => void;
    /** 사용자별 차량 사용 횟수 (useVehiclePriority에서 제공) */
    usageCounts?: Map<string, number>;
    recentDestinations?: string[];
    /** 공휴일 목록 (반복 예약에서 사용) */
    holidays?: { date: string; name: string }[];
    /** 전체 예약 목록 (반복 예약 충돌 검사용) */
    allReservations?: Reservation[];
    /** 편집 중인 반복 그룹 ID */
    editingRecurringGroupId?: string | null;
}

export default function ReservationSidePanel({
    selectedDate,
    sideTab,
    setSideTab,
    showForm,
    setShowForm,
    form,
    setForm,
    vehicles,
    favorites,
    selectedReservations,
    isPastDate,
    isToday,
    submitting,
    editingReservation,
    editingGroupId,
    routeInfo,
    routeLoading,
    freeRoadRoute,
    freeRoadLoading,
    onFetchFreeRoad,
    user,
    isAdmin = false,
    members = [],
    getCurrentTimeStr,
    onSubmit,
    onEdit,
    onCancel,
    onSlotClick,
    showFavSave,
    setShowFavSave,
    favName,
    setFavName,
    onSaveFavorite,
    onOpenForm,
    usageCounts,
    recentDestinations = [],
    holidays = [],
    allReservations = [],
    editingRecurringGroupId,
}: Props) {
    const destinationRef = useRef<HTMLInputElement>(null);

    // 폐차 제외 + 사용 빈도순 정렬
    const sortedActiveVehicles = useMemo(() => {
        const filtered = vehicles.filter(v => !v.retired?.isRetired);
        if (!usageCounts || usageCounts.size === 0) return filtered;
        return [...filtered].sort((a, b) => (usageCounts.get(b.id) || 0) - (usageCounts.get(a.id) || 0));
    }, [vehicles, usageCounts]);

    // 실제로 오늘 날짜가 예약 대상에 포함되는지 여부 (다일/반복 예약 대응)
    const actualIsToday = useMemo(() => {
        if (!isToday) return false;
        if (form.isRecurring) {
            // 반복 예약일 경우, 실제 예약될 날짜 리스트에 오늘(selectedDate)이 포함되어 있는지 검사
            const recurringStartDate = form.recurringStartDate || selectedDate;
            const dates = generateRecurringDates({
                startDate: recurringStartDate,
                endDate: form.recurringEndDate || recurringStartDate,
                selectedDays: form.recurringDays || [],
                holidays: holidays || [],
                excludeHolidays: form.excludeHolidays ?? true,
                excludedDates: form.excludedDates,
            });
            return dates.includes(selectedDate);
        }
        return isToday;
    }, [isToday, form.isRecurring, form.recurringStartDate, selectedDate, form.recurringEndDate, form.recurringDays, holidays, form.excludeHolidays, form.excludedDates]);

    // 반복 예약에는 하한을 걸지 않는다. 오늘이 반복 날짜에 포함돼 있다는 이유로 `min`을 현재
    // 시각으로 잡으면, 내일 이후 날짜에 유효한 오전 시간대를 **브라우저 기본 검증이 막아**
    // 폼 제출 자체가 되지 않는다. 오늘 회차가 이미 지난 경우는 제출 시점에 판정한다
    // (handleSubmit — 안내와 함께 차단하고, 미리보기에서 오늘을 제외하면 통과한다).
    const effectiveMinTime = actualIsToday && !form.isRecurring ? getCurrentTimeStr() : '00:00';

    /** 반복 그룹을 수정하다가 반복 체크를 끈 상태 = 단건 전환 (handleSubmit이 같은 조건으로 판정한다) */
    const isRecurringToSingle = !!editingRecurringGroupId && !form.isRecurring && !!editingReservation;

    // 반복 → 단건 전환 시 취소될 나머지 회차 수 (수정 중인 회차는 제외)
    const recurringSiblingCount = useMemo(() => {
        if (!editingRecurringGroupId || !editingReservation) return 0;
        return allReservations.filter(r =>
            r.recurringGroupId === editingRecurringGroupId
            && r.status !== 'cancelled'
            && r.id !== editingReservation.id
        ).length;
    }, [allReservations, editingRecurringGroupId, editingReservation]);

    if (!selectedDate) {
        return (
            <div className="glass-card p-8 text-center">
                <div className="text-3xl mb-2">📅</div>
                <p className="text-sm text-surface-400 dark:text-surface-500">날짜를 선택하세요</p>
            </div>
        );
    }

    const activeRes = selectedReservations.filter(r => r.status !== 'completed' && r.status !== 'cancelled');
    const completedRes = selectedReservations.filter(r => r.status === 'completed');

    return (
        <div className="glass-card p-4">
            {/* 날짜 헤더 + 예약하기 버튼 */}
            <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-surface-900 dark:text-surface-100">
                    {new Date(selectedDate + 'T00:00').toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', weekday: 'short' })}
                </h3>
                {!isPastDate && (
                    <button
                        onClick={() => onOpenForm(showForm ? undefined : sortedActiveVehicles[0]?.id)}
                        className={`text-xs font-medium px-4 py-2 min-h-[48px] rounded-lg transition-all ${showForm
                            ? 'bg-surface-200 text-surface-600 dark:bg-surface-600 dark:text-surface-300'
                            : 'bg-primary-500 text-white hover:bg-primary-600 shadow-sm'
                            }`}
                    >
                        {showForm ? '닫기' : '+ 예약'}
                    </button>
                )}
            </div>

            {/* 예약 폼 (슬라이드다운) */}
            {showForm && !isPastDate && (
                <div className="mb-4 p-3 rounded-xl bg-primary-50/50 border border-primary-100 dark:bg-surface-700/50 dark:border-surface-600 animate-fade-in">
                    <form onSubmit={onSubmit} className="space-y-4">
                        <VehicleSelector
                            vehicles={sortedActiveVehicles}
                            form={form}
                            setForm={setForm}
                            usageCounts={usageCounts}
                            destinationRef={destinationRef}
                        />
                        {/* 관리자 모드: 예약자 선택 드롭다운 */}
                        {isAdmin && editingReservation && members.length > 0 && (
                            <div>
                                <label className="label text-xs">예약자</label>
                                <select
                                    value={form.reservedByUid || ''}
                                    onChange={e => {
                                        const selected = members.find(m => m.id === e.target.value);
                                        setForm({ ...form, reservedByUid: e.target.value, reservedByName: selected?.name || '' });
                                    }}
                                    className="input text-sm min-h-[48px]"
                                >
                                    {members.map(m => (
                                        <option key={m.id} value={m.id}>
                                            {m.name || m.email} {m.role === 'admin' ? '(관리자)' : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                        <div>
                            <DestinationInput
                                form={form}
                                setForm={setForm}
                                ref={destinationRef}
                                favorites={favorites}
                                recentDestinations={recentDestinations}
                                showFavSave={showFavSave}
                                setShowFavSave={setShowFavSave}
                                favName={favName}
                                setFavName={setFavName}
                                onSaveFavorite={onSaveFavorite}
                            />
                            {/* 경로 정보 */}
                            <RouteInfoPanel
                                routeInfo={routeInfo}
                                routeLoading={routeLoading}
                                freeRoadRoute={freeRoadRoute}
                                freeRoadLoading={freeRoadLoading}
                                onFetchFreeRoad={onFetchFreeRoad}
                            />
                        </div>
                        <div>
                            <label className="label text-sm font-medium">📝 목적</label>
                            <input
                                type="text"
                                value={form.purpose}
                                onChange={e => setForm({ ...form, purpose: e.target.value })}
                                className="input w-full mt-1 text-sm min-h-[48px]"
                                placeholder="출장, 외근 등"
                            />
                        </div>

                        {/* 다일/반복 예약 체크박스 + 다일 날짜 선택 */}
                        <ReservationTypeSelector
                            form={form}
                            setForm={setForm}
                            selectedDate={selectedDate}
                            editingRecurringGroupId={editingRecurringGroupId}
                        />

                        {/* 반복 → 단건 전환 안내
                            무엇이 남고 무엇이 사라지는지 저장 전에 밝힌다. 반복 체크를 끄면
                            패널이 사라지므로, 안내가 없으면 "그래서 어느 날짜가 남나"를 알 수 없다. */}
                        {editingRecurringGroupId && !form.isRecurring && editingReservation && (
                            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800/40 animate-fade-in">
                                <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">📌 단건 예약으로 전환</p>
                                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                                    {new Date(editingReservation.date + 'T00:00').toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })} 예약만 남고,
                                    같은 반복 그룹의 나머지 {recurringSiblingCount}건은 취소됩니다.
                                </p>
                            </div>
                        )}

                        {/* 반복 예약 설정 패널 */}
                        {form.isRecurring && (
                            <RecurringReservationPanel
                                form={form}
                                setForm={setForm}
                                selectedDate={selectedDate}
                                holidays={holidays}
                                allReservations={allReservations}
                                editingRecurringGroupId={editingRecurringGroupId}
                            />
                        )}

                        {/* 시작/종료 시간
                            입력 도중의 값으로 판정해 되돌리지 않는다. time 입력은 오전/오후·시·분을
                            **한 칸씩** 바꾸며 그때마다 onChange를 부르는데, 중간값이 조건에 걸린다고
                            state 갱신을 건너뛰면 입력이 곧바로 이전 값으로 되돌아간다. 그래서 오후
                            11:30을 오전으로 바꾸거나 이른 시간으로 옮기는 것 자체가 불가능했다.
                            유효성은 제출 시점(handleSubmit)에서 판정한다. */}
                        <div>
                            <label className="label text-sm font-medium mb-1">⏰ 운행 시간</label>
                            <div className="flex items-center gap-2 mt-1">
                                <input
                                    type="time"
                                    value={form.startTime}
                                    min={effectiveMinTime}
                                    onChange={e => {
                                        const val = e.target.value;
                                        if (!val) return; // 브라우저가 입력 중간에 보내는 빈 값은 무시
                                        const autoEnd = calcEndTime(val, routeInfo?.duration || 0);
                                        setForm({ ...form, startTime: val, endTime: autoEnd });
                                    }}
                                    className="input flex-1 text-base font-medium px-2 text-center min-h-[48px]"
                                />
                                <span className="text-surface-400 dark:text-surface-500 font-bold px-1 text-lg">~</span>
                                <input
                                    type="time"
                                    value={form.endTime}
                                    onChange={e => {
                                        const val = e.target.value;
                                        if (!val) return;
                                        setForm({ ...form, endTime: val });
                                    }}
                                    className="input flex-1 text-base font-medium px-2 text-center min-h-[48px]"
                                />
                            </div>
                        </div>
                        <button type="submit" disabled={submitting} className={`w-full btn-sm min-h-[48px] ${form.isRecurring ? 'bg-purple-500 hover:bg-purple-600 dark:hover:bg-purple-500 text-white rounded-xl py-2 font-semibold transition-colors disabled:opacity-50' : 'btn-primary'}`}>
                            {submitting
                                ? (isRecurringToSingle ? '전환 중...' : editingRecurringGroupId ? '반복 예약 수정 중...' : editingGroupId ? '다일 예약 수정 중...' : editingReservation ? '수정 중...' : form.isRecurring ? '반복 예약 생성 중...' : '예약 중...')
                                : (isRecurringToSingle ? '단건 예약으로 전환' : editingRecurringGroupId ? '반복 예약 수정' : editingGroupId ? '다일 예약 수정' : editingReservation ? '예약 수정' : form.isRecurring ? '반복 예약 확정' : '예약 확정')}
                        </button>
                    </form>
                </div>
            )}

            <ReservationTabContent
                sideTab={sideTab}
                setSideTab={setSideTab}
                activeRes={activeRes}
                completedRes={completedRes}
                sortedActiveVehicles={sortedActiveVehicles}
                selectedReservations={selectedReservations}
                onSlotClick={onSlotClick}
                isPastDate={isPastDate}
                isToday={isToday}
                onEdit={onEdit}
                onCancel={onCancel}
                user={user}
                isAdmin={isAdmin}
                setShowForm={setShowForm}
            />
        </div>
    );
}
