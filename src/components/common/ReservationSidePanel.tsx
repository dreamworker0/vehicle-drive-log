/**
 * ReservationSidePanel — 예약 사이드 패널 (예약 폼 + 예약 목록)
 * ReservationCalendar에서 추출된 서브 컴포넌트
 */
import React, { useRef, useMemo, useState } from 'react';
import { VEHICLE_TYPE_ICONS, getVehicleColor } from '../../lib/constants';
import { calcEndTime } from '../../hooks/utils/reservationUtils';
import { parseDestinations } from '../../lib/tmap';
import { isVehicleBlocked } from '../../lib/vehicleUtils';
import VehicleTimelineBar from './VehicleTimelineBar';
import type { Vehicle } from '../../types/vehicle';
import type { Favorite } from '../../types/favorite';
import type { Reservation } from '../../types/reservation';
import type { User as UserDoc } from '../../types/user';

interface ReservationForm {
    vehicleId: string;
    destination: string;
    purpose: string;
    startTime: string;
    endTime: string;
    endDate?: string;
    reservedByUid?: string;
    reservedByName?: string;
}

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
    routeInfo: { distance: number; duration: number; tollFee?: number; isMulti?: boolean; freeRoadRoute?: { distance: number; duration: number; tollFee: number } } | null;
    routeLoading: boolean;
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
    user,
    isAdmin = false,
    members = [],
    getCurrentTimeStr,
    getMinStartTime,
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
}: Props) {
    const destinationRef = useRef<HTMLInputElement>(null);
    const [showFreeRoad, setShowFreeRoad] = useState(false);

    // 폐차 제외 + 사용 빈도순 정렬
    const sortedActiveVehicles = useMemo(() => {
        const filtered = vehicles.filter(v => !v.retired?.isRetired);
        if (!usageCounts || usageCounts.size === 0) return filtered;
        return [...filtered].sort((a, b) => (usageCounts.get(b.id) || 0) - (usageCounts.get(a.id) || 0));
    }, [vehicles, usageCounts]);

    if (!selectedDate) {
        return (
            <div className="glass-card p-8 text-center">
                <div className="text-3xl mb-2">📅</div>
                <p className="text-sm text-surface-400">날짜를 선택하세요</p>
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
                        className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-all ${showForm
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
                        <div>
                            <label className="label text-sm font-medium">🚘 차량 <span className="text-red-500">*</span></label>
                            <div className="grid grid-cols-3 gap-2 mt-1.5">
                                {sortedActiveVehicles.map(v => {
                                    const isBlocked = isVehicleBlocked(v.maintenance);
                                    const count = usageCounts?.get(v.id) || 0;
                                    return (
                                        <button
                                            key={v.id}
                                            type="button"
                                            onClick={() => { if (!isBlocked) { setForm({ ...form, vehicleId: v.id }); setTimeout(() => destinationRef.current?.focus(), 50); } }}
                                            disabled={isBlocked}
                                            className={`p-2.5 rounded-xl border text-left transition-all relative ${isBlocked
                                                ? 'border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-800 opacity-50 cursor-not-allowed'
                                                : form.vehicleId === v.id
                                                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/40 ring-1 ring-primary-500/50 shadow-md transform -translate-y-0.5'
                                                    : 'border-surface-200 dark:border-surface-600 hover:border-surface-300 hover:bg-surface-50 bg-white dark:bg-surface-800 shadow-sm'
                                                }`}
                                        >
                                            {count > 0 && !isBlocked && (
                                                <span title={`최근 사용: ${count}회`} className="absolute -top-1.5 -right-1.5 min-w-[20px] h-[20px] px-1 rounded-full bg-primary-500 text-white text-[10px] font-bold flex items-center justify-center shadow-md">
                                                    {count}
                                                </span>
                                            )}
                                            <div className="flex flex-col items-center gap-1">
                                                <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-base ${isBlocked ? 'bg-surface-200 dark:bg-surface-700' : getVehicleColor(v.id)}`}>
                                                    {isBlocked ? '🔧' : (VEHICLE_TYPE_ICONS[v.vehicleType as keyof typeof VEHICLE_TYPE_ICONS] || '🚗')}
                                                </span>
                                                <p className={`font-medium text-xs text-center leading-tight ${isBlocked ? 'text-surface-400' : 'text-surface-900 dark:text-surface-100'}`}>{v.displayName}</p>
                                                {isBlocked && (
                                                    <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">정비 중</span>
                                                )}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
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
                                    className="input text-sm"
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
                            <label className="label text-sm font-medium">📍 목적지 <span className="text-red-500">*</span></label>
                            <div className="flex items-center gap-1.5 mt-1">
                                <input
                                    ref={destinationRef}
                                    type="text"
                                    value={form.destination}
                                    onChange={e => setForm({ ...form, destination: e.target.value })}
                                    className="input flex-1 text-sm"
                                    placeholder="예: 강남역, 서울역 (여러 곳 운행은 쉼표로 구분)"
                                    required
                                />
                                {/* 즐겨찾기 저장 아이콘 버튼 */}
                                {form.destination.trim() && parseDestinations(form.destination).length <= 1 && !favorites.some(f => f.address === form.destination.trim() || f.name === form.destination.trim()) && (
                                    <button
                                        type="button"
                                        onClick={() => setShowFavSave(!showFavSave)}
                                        className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-all ${showFavSave
                                            ? 'bg-amber-100 text-amber-600 border border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700'
                                            : 'bg-surface-100 text-amber-500 border border-surface-200 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-600 dark:bg-surface-700 dark:border-surface-600 dark:text-amber-400 dark:hover:bg-amber-900/30'
                                            }`}
                                        title="즐겨찾기에 저장"
                                    >
                                        {showFavSave ? '⭐' : '☆'}
                                    </button>
                                )}
                            </div>
                            {/* 즐겨찾기 저장 폼 */}
                            {showFavSave && (
                                <div className="mt-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800/40 animate-fade-in">
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="text"
                                            value={favName}
                                            onChange={e => setFavName(e.target.value)}
                                            className="input flex-1 text-xs py-1.5"
                                            placeholder="별칭 (예: 김OO 어르신 댁)"
                                        />
                                        <button
                                            type="button"
                                            onClick={onSaveFavorite}
                                            className="btn-primary text-xs !py-1.5 !px-2.5 whitespace-nowrap"
                                        >
                                            저장
                                        </button>
                                    </div>
                                </div>
                            )}
                            {/* 퀵 선택 (즐겨찾기 + 최근 목적지) 칩 */}
                            {(favorites.length > 0 || recentDestinations.length > 0) && (
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                    {/* 즐겨찾기 */}
                                    {favorites.map(fav => (
                                        <button
                                            key={`fav-${fav.id}`}
                                            type="button"
                                            onClick={() => setForm({ ...form, destination: fav.address || fav.name })}
                                            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all flex items-center gap-1 shrink-0 ${form.destination === (fav.address || fav.name)
                                                ? 'bg-amber-100 border-amber-300 text-amber-700 dark:bg-amber-900/40 dark:border-amber-700 dark:text-amber-300'
                                                : 'bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:border-amber-300 hover:bg-amber-50 dark:hover:border-amber-700 dark:hover:bg-amber-900/20'
                                                }`}
                                        >
                                            <span className="text-[10px]">⭐</span>
                                            {fav.name}
                                        </button>
                                    ))}
                                    {/* 구분선 (둘 다 있을 경우) */}
                                    {favorites.length > 0 && recentDestinations.length > 0 && (
                                        <div className="w-[1px] h-5 bg-surface-200 dark:bg-surface-700 mx-1 self-center" />
                                    )}
                                    {/* 최근 목적지 */}
                                    {recentDestinations.filter(dest => !favorites.some(f => (f.address || f.name) === dest)).map(dest => (
                                        <button
                                            key={`recent-${dest}`}
                                            type="button"
                                            onClick={() => setForm({ ...form, destination: dest })}
                                            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all flex items-center gap-1 shrink-0 ${form.destination === dest
                                                ? 'bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-900/40 dark:border-blue-700 dark:text-blue-300'
                                                : 'bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:border-blue-300 hover:bg-blue-50 dark:hover:border-blue-700 dark:hover:bg-blue-900/20'
                                                }`}
                                        >
                                            <span className="text-[10px] opacity-70">🕒</span>
                                            {dest}
                                        </button>
                                    ))}
                                </div>
                            )}
                            {/* 경로 정보 */}
                            {(routeLoading || routeInfo) && (
                                <div className="mt-2">
                                    {routeLoading ? (
                                        <div className="flex items-center gap-2 text-xs text-surface-400 py-1">
                                            <div className="w-3 h-3 spinner" />
                                            경로 탐색 중...
                                        </div>
                                    ) : routeInfo && (
                                        <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200 dark:bg-blue-900/20 dark:border-blue-800/40 animate-fade-in space-y-1.5">
                                            <div className="flex items-center gap-3 text-xs">
                                                {routeInfo.freeRoadRoute && <span className="text-[11px] font-semibold text-blue-500 dark:text-blue-400 bg-blue-100 dark:bg-blue-800/40 px-1.5 py-0.5 rounded">고속</span>}
                                                <span className="font-bold text-blue-700 dark:text-blue-300">🗺️ {routeInfo.isMulti ? '총 ' : ''}{Math.floor(routeInfo.distance)}km</span>
                                                <span className="font-bold text-blue-700 dark:text-blue-300">⏱ {routeInfo.isMulti ? '총 ' : ''}{routeInfo.duration}분</span>
                                                {(routeInfo.tollFee ?? 0) > 0 && (
                                                    <span className="text-blue-600 dark:text-blue-400">₩{(routeInfo.tollFee ?? 0).toLocaleString()}</span>
                                                )}
                                                {routeInfo.freeRoadRoute && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowFreeRoad(prev => !prev)}
                                                        className="ml-auto flex-shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-blue-100 dark:hover:bg-blue-800/40 transition-colors"
                                                        title="무료도로 경로 보기"
                                                    >
                                                        <svg className={`w-3.5 h-3.5 text-blue-500 dark:text-blue-400 transition-transform duration-200 ${showFreeRoad ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
                                                    </button>
                                                )}
                                            </div>
                                            {showFreeRoad && routeInfo.freeRoadRoute && (
                                                <div className="flex items-center gap-3 text-xs border-t border-blue-200/50 dark:border-blue-800/30 pt-1.5 animate-fade-in">
                                                    <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-800/40 px-1.5 py-0.5 rounded">무료</span>
                                                    <span className="font-bold text-emerald-700 dark:text-emerald-300">🗺️ {Math.floor(routeInfo.freeRoadRoute.distance)}km</span>
                                                    <span className="font-bold text-emerald-700 dark:text-emerald-300">⏱ {routeInfo.freeRoadRoute.duration}분</span>
                                                    {routeInfo.freeRoadRoute.tollFee > 0 && (
                                                        <span className="text-emerald-600 dark:text-emerald-400">₩{routeInfo.freeRoadRoute.tollFee.toLocaleString()}</span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                        <div>
                            <label className="label text-sm font-medium">📝 목적</label>
                            <input
                                type="text"
                                value={form.purpose}
                                onChange={e => setForm({ ...form, purpose: e.target.value })}
                                className="input w-full mt-1 text-sm"
                                placeholder="출장, 외근 등"
                            />
                        </div>
                        {/* 다일 예약 체크박스 (독립 행) */}
                        <div className="flex justify-end pt-1">
                            <label className="flex items-center gap-2 cursor-pointer select-none px-2 py-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors">
                                <input
                                    type="checkbox"
                                    checked={!!(form.endDate && form.endDate > selectedDate)}
                                    onChange={e => {
                                        if (e.target.checked) {
                                            const next = new Date(selectedDate + 'T00:00');
                                        next.setDate(next.getDate() + 1);
                                        const y = next.getFullYear();
                                        const m = String(next.getMonth() + 1).padStart(2, '0');
                                        const d = String(next.getDate()).padStart(2, '0');
                                        setForm({ ...form, endDate: `${y}-${m}-${d}` });
                                    } else {
                                        setForm({ ...form, endDate: '' });
                                    }
                                }}
                                className="w-4 h-4 rounded border-surface-300 dark:border-surface-600 text-primary-600 focus:ring-primary-500"
                            />
                            <span className="text-sm font-medium text-surface-600 dark:text-surface-300">
                                다일 예약
                                {form.endDate && form.endDate > selectedDate && (() => {
                                    const start = new Date(selectedDate + 'T00:00');
                                    const end = new Date(form.endDate + 'T00:00');
                                    const diffDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                                    return <span className="text-blue-600 dark:text-blue-400 font-bold ml-1">· {diffDays}일간</span>;
                                })()}
                            </span>
                            </label>
                        </div>
                        {/* 시작일 / 종료일 (체크 시 표시, 나란히 한 줄) */}
                        {form.endDate && form.endDate > selectedDate && (
                            <div className="grid grid-cols-2 gap-2 animate-fade-in">
                                <div>
                                    <label className="label text-xs text-surface-400">시작일</label>
                                    <p className="text-sm text-surface-600 dark:text-surface-300 px-2 py-1.5 bg-surface-100 dark:bg-surface-700/50 rounded-lg h-[38px] flex items-center">
                                        {selectedDate}
                                        <span className="text-surface-400 ml-1 text-xs">
                                            ({['일','월','화','수','목','금','토'][new Date(selectedDate + 'T00:00').getDay()]})
                                        </span>
                                    </p>
                                </div>
                                <div>
                                    <label className="label text-xs">종료일</label>
                                        <input
                                            type="date"
                                            value={form.endDate}
                                            min={selectedDate}
                                            onChange={e => setForm({ ...form, endDate: e.target.value })}
                                            className="input text-sm px-2 h-[38px]"
                                        />
                                </div>
                            </div>
                        )}
                        {/* 시작/종료 시간 */}
                        <div>
                            <label className="label text-sm font-medium mb-1">⏰ 운행 시간</label>
                            <div className="flex items-center gap-2 mt-1">
                                <input
                                    type="time"
                                    value={form.startTime}
                                    min={getMinStartTime()}
                                    onChange={e => {
                                        const val = e.target.value;
                                        if (isToday && val < getCurrentTimeStr()) return;
                                        const autoEnd = calcEndTime(val, routeInfo?.duration || 0);
                                        setForm({ ...form, startTime: val, endTime: autoEnd });
                                    }}
                                    className="input flex-1 text-base font-medium px-2 text-center"
                                />
                                <span className="text-surface-400 font-bold px-1 text-lg">~</span>
                                <input
                                    type="time"
                                    value={form.endTime}
                                    min={form.startTime}
                                    onChange={e => {
                                        const val = e.target.value;
                                        if (val <= form.startTime) return;
                                        setForm({ ...form, endTime: val });
                                    }}
                                    className="input flex-1 text-base font-medium px-2 text-center"
                                />
                            </div>
                        </div>
                        <button type="submit" disabled={submitting} className="btn-primary w-full btn-sm">
                            {submitting
                                ? (editingGroupId ? '다일 예약 수정 중...' : editingReservation ? '수정 중...' : '예약 중...')
                                : (editingGroupId ? '다일 예약 수정' : editingReservation ? '예약 수정' : '예약 확정')}
                        </button>
                    </form>
                </div>
            )}

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
        </div>
    );
}
