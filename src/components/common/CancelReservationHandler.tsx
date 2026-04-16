/**
 * CancelReservationHandler
 * URL에 ?cancelReservation=예약ID가 있을 때 취소 확인 다이얼로그를 표시
 */
import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { cancelReservation } from '../../lib/firestore';
import type { Reservation } from '../../types/reservation';

export default function CancelReservationHandler() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [reservation, setReservation] = useState<Reservation | null>(null);
    const [loading, setLoading] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const [result, setResult] = useState<'cancelled' | 'kept' | 'error' | null>(null);

    const reservationId = searchParams.get('cancelReservation');

    // 예약 정보 조회
    useEffect(() => {
        if (!reservationId) return;

        setLoading(true);
        getDoc(doc(db, 'reservations', reservationId))
            .then((snap) => {
                if (snap.exists()) {
                    setReservation({ id: snap.id, ...snap.data() } as Reservation);
                } else {
                    setResult('error');
                }
            })
            .catch(() => setResult('error'))
            .finally(() => setLoading(false));
    }, [reservationId]);

    // URL 파라미터 제거
    const clearParam = useCallback(() => {
        searchParams.delete('cancelReservation');
        setSearchParams(searchParams, { replace: true });
    }, [searchParams, setSearchParams]);

    // 취소 처리
    const handleCancel = async () => {
        if (!reservationId) return;
        setCancelling(true);
        try {
            await cancelReservation(reservationId);
            setResult('cancelled');
        } catch {
            setResult('error');
        } finally {
            setCancelling(false);
        }
    };

    // 유지 처리
    const handleKeep = () => {
        setResult('kept');
    };

    // 닫기 (결과 화면에서)
    const handleClose = () => {
        setReservation(null);
        setResult(null);
        clearParam();
    };

    // 표시할 내용이 없으면 렌더링하지 않음
    if (!reservationId) return null;

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white dark:bg-surface-800 rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden">
                {/* 로딩 */}
                {loading && (
                    <div className="p-8 text-center">
                        <div className="w-10 h-10 spinner mx-auto mb-3"></div>
                        <p className="text-surface-500 text-sm">예약 정보를 불러오는 중...</p>
                    </div>
                )}

                {/* 결과 표시 */}
                {result && (
                    <div className="p-8 text-center">
                        <div className="text-4xl mb-3">
                            {result === 'cancelled' ? '✅' : result === 'kept' ? '👍' : '⚠️'}
                        </div>
                        <h3 className="text-lg font-bold text-surface-900 dark:text-surface-100 mb-2">
                            {result === 'cancelled' && '예약이 취소되었습니다'}
                            {result === 'kept' && '예약이 유지됩니다'}
                            {result === 'error' && '처리할 수 없습니다'}
                        </h3>
                        <p className="text-sm text-surface-500 dark:text-surface-400 mb-6">
                            {result === 'cancelled' && '해당 예약이 성공적으로 취소되었습니다.'}
                            {result === 'kept' && '예약이 그대로 유지됩니다. 운행을 시작해주세요.'}
                            {result === 'error' && '예약을 찾을 수 없거나 이미 처리되었습니다.'}
                        </p>
                        <button
                            onClick={handleClose}
                            className="btn-primary w-full"
                        >
                            확인
                        </button>
                    </div>
                )}

                {/* 취소 확인 다이얼로그 */}
                {!loading && !result && reservation && (
                    <div>
                        {/* 헤더 */}
                        <div className="bg-gradient-to-r from-red-500 to-orange-500 p-5 text-white text-center">
                            <div className="text-3xl mb-2">🚨</div>
                            <h3 className="text-lg font-bold">예약 시작시간이 지났습니다</h3>
                        </div>

                        {/* 예약 정보 */}
                        <div className="p-5">
                            <div className="bg-surface-50 dark:bg-surface-700/50 rounded-xl p-4 mb-5 space-y-2">
                                <div className="flex justify-between text-sm">
                                    <span className="text-surface-500 dark:text-surface-400">차량</span>
                                    <span className="font-medium text-surface-900 dark:text-surface-100">
                                        {reservation.vehicleDisplayName || '차량'}
                                    </span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-surface-500 dark:text-surface-400">날짜</span>
                                    <span className="font-medium text-surface-900 dark:text-surface-100">
                                        {reservation.date}
                                    </span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-surface-500 dark:text-surface-400">시간</span>
                                    <span className="font-medium text-surface-900 dark:text-surface-100">
                                        {reservation.startTime} ~ {reservation.endTime}
                                    </span>
                                </div>
                                {reservation.destination && (
                                    <div className="flex justify-between text-sm">
                                        <span className="text-surface-500 dark:text-surface-400">목적지</span>
                                        <span className="font-medium text-surface-900 dark:text-surface-100">
                                            {reservation.destination}
                                        </span>
                                    </div>
                                )}
                            </div>

                            <p className="text-sm text-surface-600 dark:text-surface-300 text-center mb-5">
                                운행을 시작하지 않으셨나요?<br />
                                예약을 취소하시겠습니까?
                            </p>

                            {/* 버튼 */}
                            <div className="flex gap-3">
                                <button
                                    onClick={handleKeep}
                                    disabled={cancelling}
                                    className="flex-1 py-3 px-4 rounded-xl border-2 border-surface-200 dark:border-surface-600 text-surface-700 dark:text-surface-200 font-semibold text-sm hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors"
                                >
                                    계속 유지
                                </button>
                                <button
                                    onClick={handleCancel}
                                    disabled={cancelling}
                                    className="flex-1 py-3 px-4 rounded-xl bg-red-500 hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-700 text-white font-semibold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {cancelling ? (
                                        <>
                                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                            취소 중...
                                        </>
                                    ) : (
                                        '예약 취소'
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
