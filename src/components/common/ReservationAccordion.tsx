/**
 * ReservationAccordion — VehicleTimelineBar의 차량별 예약 상세 아코디언
 * 차량명/예약 블록 클릭 시 펼쳐지는 예약 목록(예약자·시간·목적지·경로 + 수정/취소).
 * 권한 표시는 UI 위임일 뿐이며, 실제 권한은 백엔드(Rules/Functions)에서 재검증된다.
 */
import type { Reservation } from '../../types/reservation';

interface ReservationAccordionProps {
    reservations: Reservation[];
    isExpanded: boolean;
    onEdit?: (res: Reservation) => void;
    onCancel?: (resId: string) => void;
    user: { uid?: string; id?: string } | null;
    isAdmin: boolean;
    setShowForm?: (show: boolean) => void;
}

export default function ReservationAccordion({
    reservations, isExpanded, onEdit, onCancel, user, isAdmin, setShowForm,
}: ReservationAccordionProps) {
    if (!isExpanded || reservations.length === 0) return null;

    return (
        <div className="ml-[72px] pl-2 mt-1 mb-1 border-l-2 border-primary-300 dark:border-primary-700 animate-fade-in">
            {reservations.map(r => {
                const resEndDateTime = new Date(`${r.date}T${r.endTime || '23:59'}`);
                const isPastReservation = resEndDateTime < new Date();
                return (
                    <div key={r.id} className="py-1.5 first:pt-0.5 last:pb-0.5">
                        <div className="flex items-center justify-between gap-1">
                            <div className="text-[11px] text-surface-600 dark:text-surface-300 truncate">
                                <span className="font-medium">{r.reservedByName}</span>
                                <span className="mx-1 text-surface-300 dark:text-surface-600">|</span>
                                {r.startTime} ~ {r.endTime}
                                {r.destination && <span className="mx-1 text-surface-300 dark:text-surface-600">|</span>}
                                {r.destination && <span>{r.destination}</span>}
                                {r.purpose && <span>, {r.purpose}</span>}
                                {r.groupId && <span className="ml-1 text-blue-500 dark:text-blue-400" title="다일 예약">🔗</span>}
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                                {r.syncSource === 'calendar' && (
                                    <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300 rounded-full font-medium">
                                        📅
                                    </span>
                                )}
                                {r.status === 'pending' && (
                                    <span className="text-[10px] px-1.5 py-0.5 badge-warning rounded-full font-medium whitespace-nowrap">
                                        승인 대기
                                    </span>
                                )}
                                {(isAdmin || r.reservedByUid === user?.id || r.reservedByUid === user?.uid) && !isPastReservation && (
                                    <>
                                        <button onClick={() => { onEdit?.(r); setShowForm?.(true); }} className="text-[11px] leading-none py-0.5 text-primary-500 dark:text-primary-400 hover:underline min-w-[48px] min-h-[48px] flex items-center justify-center">수정</button>
                                        <button onClick={() => onCancel?.(r.id)} className="text-[11px] leading-none py-0.5 text-red-500 dark:text-red-400 hover:underline min-w-[48px] min-h-[48px] flex items-center justify-center">취소</button>
                                    </>
                                )}
                            </div>
                        </div>
                        {r.routeDistance && (
                            <p className="text-[11px] text-blue-500 dark:text-blue-400 mt-0.5 flex items-center gap-2">
                                <span>🗺️ {Math.floor(r.routeDistance)}km</span>
                                <span>⏱ {r.routeDuration}분</span>
                                {(r.routeTollFee ?? 0) > 0 && <span>₩{r.routeTollFee?.toLocaleString()}</span>}
                            </p>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
