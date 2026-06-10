/**
 * HipassChargeTab — 직원용 하이패스 충전 기록 탭
 * 카드 선택 → 충전금액 입력 → 잔액 자동 계산 → 충전 리스트
 */
import useHipassCharge from '../../hooks/useHipassCharge';
import { VEHICLE_TYPE_ICONS, getVehicleColor } from '../../lib/constants';
import { SkeletonBox, SkeletonList } from '../common/Skeleton';

export default function HipassChargeTab() {
    const {
        cards, selectedCardId, selectedCard,
        records, loading, saving,
        showForm, setShowForm,
        form, setForm,
        balanceAfter, totalChargeAmount,
        handleCardSelect, handleSubmit, handleDelete,
        getVehicleById,
        currentUid,
    } = useHipassCharge();

    if (loading) {
        return (
            <div className="animate-fade-in">
                <SkeletonBox className="h-10 w-full mb-4" />
                <SkeletonList count={3} />
            </div>
        );
    }

    // 등록된 하이패스 카드가 없을 때
    if (cards.length === 0) {
        return (
            <div className="glass-card p-12 text-center animate-fade-in">
                <div className="text-4xl mb-3">💳</div>
                <p className="text-surface-400 dark:text-surface-500 font-medium">등록된 하이패스 카드가 없습니다</p>
                <p className="text-sm text-surface-300 dark:text-surface-600 mt-1">관리자에게 하이패스 카드 등록을 요청하세요</p>
            </div>
        );
    }

    return (
        <div className="animate-fade-in space-y-4">
            {/* 카드 선택 */}
            <div>
                <label className="label text-xs">하이패스 카드 선택</label>
                <select
                    value={selectedCardId}
                    onChange={e => handleCardSelect(e.target.value)}
                    className="input min-h-[48px]"
                >
                    <option value="">카드를 선택하세요</option>
                    {cards.map(card => (
                        <option key={card.id} value={card.id}>
                            💳 {card.cardNumber} — {card.vehicleName || '(차량 미연결)'}
                        </option>
                    ))}
                </select>
            </div>

            {/* 선택된 카드 정보 */}
            {selectedCard && (
                <>
                    <div className="glass-card p-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                {(() => {
                                    const vehicle = getVehicleById(selectedCard.vehicleId);
                                    const vehicleIcon = vehicle?.vehicleType ? (VEHICLE_TYPE_ICONS[vehicle.vehicleType] || '🚗') : '🚗';
                                    const vehicleBg = vehicle ? getVehicleColor(vehicle.id) : 'bg-surface-200 dark:bg-surface-700';
                                    return (
                                        <div className={`w-10 h-10 rounded-xl ${vehicleBg} flex items-center justify-center text-xl`}>
                                            {vehicleIcon}
                                        </div>
                                    );
                                })()}
                                <div>
                                    <p className="font-semibold text-sm text-surface-900 dark:text-surface-100">
                                        {selectedCard.vehicleName || '(차량 미연결)'}
                                    </p>
                                    <p className="text-xs text-surface-400 dark:text-surface-500 font-mono">
                                        {selectedCard.cardNumber}
                                    </p>
                                </div>
                            </div>
                            <div className="text-right">
                                <p className="text-xs text-surface-400 dark:text-surface-500">현재 잔액</p>
                                <p className={`text-lg font-bold ${
                                    selectedCard.balance <= 5000
                                        ? 'text-red-500 dark:text-red-400'
                                        : selectedCard.balance <= 20000
                                            ? 'text-amber-500 dark:text-amber-400'
                                            : 'text-accent-600 dark:text-accent-400'
                                }`}>
                                    {selectedCard.balance.toLocaleString()}원
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* 충전 등록 버튼 / 폼 */}
                    {!showForm ? (
                        <button
                            onClick={() => setShowForm(true)}
                            className="btn-primary btn-sm w-full flex items-center justify-center gap-1 min-h-[48px]"
                        >
                            💳 충전 등록
                        </button>
                    ) : (
                        <form onSubmit={handleSubmit} className="glass-card p-4 space-y-3 animate-fade-in">
                            <h2 className="font-semibold text-sm text-surface-800 dark:text-surface-200">
                                새 충전 기록
                            </h2>

                            {/* 날짜 */}
                            <div>
                                <label className="label text-xs">📅 날짜 <span className="text-red-500 dark:text-red-400">*</span></label>
                                <input
                                    type="date"
                                    value={form.date}
                                    onChange={e => setForm({ ...form, date: e.target.value })}
                                    className="input min-h-[48px]"
                                    required
                                />
                            </div>

                            {/* 충전금액 */}
                            <div>
                                <label className="label text-xs">💰 충전금액 (원) <span className="text-red-500 dark:text-red-400">*</span></label>
                                <input
                                    type="number"
                                    value={form.chargeAmount}
                                    onChange={e => setForm({ ...form, chargeAmount: e.target.value })}
                                    className="input min-h-[48px]"
                                    placeholder="50000"
                                    min="1"
                                    required
                                />
                            </div>

                            {/* 잔액 계산 미리보기 */}
                            {balanceAfter !== null && (
                                <div className="bg-primary-50 dark:bg-primary-900/20 rounded-xl p-3 space-y-1">
                                    <div className="flex justify-between text-xs text-surface-500 dark:text-surface-400">
                                        <span>충전 전 잔액</span>
                                        <span>{selectedCard.balance.toLocaleString()}원</span>
                                    </div>
                                    <div className="flex justify-between text-xs text-primary-600 dark:text-primary-400 font-medium">
                                        <span>+ 충전금액</span>
                                        <span>+{parseInt(form.chargeAmount).toLocaleString()}원</span>
                                    </div>
                                    <div className="border-t border-primary-200 dark:border-primary-700 pt-1 mt-1">
                                        <div className="flex justify-between text-sm font-bold text-surface-900 dark:text-surface-100">
                                            <span>충전 후 잔액</span>
                                            <span className="text-accent-600 dark:text-accent-400">
                                                {balanceAfter.toLocaleString()}원
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="flex justify-end gap-2 pt-1">
                                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary btn-sm min-h-[48px]">
                                    취소
                                </button>
                                <button type="submit" disabled={saving} className="btn-primary btn-sm min-h-[48px]">
                                    {saving ? '저장 중...' : '충전 기록 저장'}
                                </button>
                            </div>
                        </form>
                    )}

                    {/* 충전 기록 리스트 */}
                    <div>
                        <p className="text-xs text-surface-400 dark:text-surface-500 mb-2">
                            충전 기록 {records.length}건
                            {totalChargeAmount > 0 && ` · 총 ${totalChargeAmount.toLocaleString()}원`}
                        </p>
                        {records.length === 0 ? (
                            <div className="glass-card p-8 text-center">
                                <p className="text-surface-400 dark:text-surface-500 text-sm">이 카드의 충전 기록이 없습니다</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {records.map(rec => {
                                    const isOwn = rec.chargerUid === currentUid;
                                    return (
                                        <div
                                            key={rec.id}
                                            className="glass-card p-3.5 flex items-center gap-3 transition-all"
                                        >
                                            {/* 아이콘 */}
                                            {(() => {
                                                const vehicle = getVehicleById(rec.vehicleId);
                                                const vehicleIcon = vehicle?.vehicleType ? (VEHICLE_TYPE_ICONS[vehicle.vehicleType] || '🚗') : '🚗';
                                                const vehicleBg = vehicle ? getVehicleColor(vehicle.id) : 'bg-surface-200 dark:bg-surface-700';
                                                return (
                                                    <div className={`w-9 h-9 rounded-xl ${vehicleBg} flex items-center justify-center text-lg flex-shrink-0`}>
                                                        {vehicleIcon}
                                                    </div>
                                                );
                                            })()}

                                            {/* 정보 */}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-bold text-sm text-surface-900 dark:text-surface-100">
                                                        +{rec.chargeAmount?.toLocaleString()}원
                                                    </span>
                                                    <span className="text-xs text-surface-400 dark:text-surface-500">{rec.chargerName}</span>
                                                </div>
                                                <p className="text-xs text-surface-400 dark:text-surface-500 mt-0.5">
                                                    {rec.date} · 잔액 {rec.balanceBefore?.toLocaleString()} → {rec.balanceAfter?.toLocaleString()}원
                                                </p>
                                            </div>

                                            {/* 삭제 */}
                                            {isOwn && (
                                                <button
                                                    onClick={() => handleDelete(rec)}
                                                    className="text-[10px] text-surface-300 dark:text-surface-600 hover:text-red-500 dark:hover:text-red-400 transition-colors flex-shrink-0 min-w-[48px] min-h-[48px] flex items-center justify-center"
                                                    aria-label="충전 기록 삭제"
                                                >
                                                    삭제
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
