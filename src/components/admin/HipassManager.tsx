/**
 * HipassManager — 하이패스 관리 페이지
 * 로직은 useHipassManager 훅 사용
 */
import useHipassManager from '../../hooks/useHipassManager';
import ConfirmModal from '../common/ConfirmModal';
import { SkeletonCard, SkeletonBox } from '../common/Skeleton';
import { VEHICLE_TYPE_ICONS, getVehicleColor } from '../../lib/constants';

export default function HipassManager() {
    const {
        cards, availableVehicles, loading,
        showForm, setShowForm,
        editingCard, formLoading, form, setForm,
        modal, closeModal,
        resetForm, handleEdit, handleCardNumberChange, handleSubmit,
        openDeleteModal, confirmDelete,
        getVehicleById,
    } = useHipassManager();

    if (loading) {
        return (
            <div className="max-w-4xl mx-auto animate-fade-in">
                <SkeletonBox className="h-7 w-36 mb-1" />
                <SkeletonBox className="h-4 w-20 mb-6" />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <SkeletonCard />
                    <SkeletonCard />
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto animate-fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">하이패스 관리</h1>
                    <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">
                        등록 {cards.length}건
                    </p>
                </div>
                <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary btn-sm min-h-[48px]">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    하이패스 등록
                </button>
            </div>

            {/* 등록/수정 모달 */}
            {showForm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
                    <div className="glass-card p-6 w-full max-w-md max-h-[90vh] overflow-y-auto animate-scale-in">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-surface-900 dark:text-surface-100">
                                {editingCard ? '하이패스 수정' : '하이패스 등록'}
                            </h3>
                            <button
                                type="button"
                                onClick={resetForm}
                                className="p-1.5 rounded-lg text-surface-400 hover:text-surface-600 hover:bg-surface-100 dark:hover:text-surface-300 dark:hover:bg-surface-700 transition-colors min-h-[48px] min-w-[48px] flex items-center justify-center"
                                aria-label="닫기"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="label">카드번호 <span className="text-red-500">*</span></label>
                                <input
                                    type="text" value={form.cardNumber}
                                    onChange={e => handleCardNumberChange(e.target.value)}
                                    className="input font-mono tracking-wider min-h-[48px]"
                                    placeholder="0000-0000-0000-0000"
                                    maxLength={19}
                                    required
                                    inputMode="numeric"
                                />
                                <p className="text-xs text-surface-400 mt-1">숫자 16자리 (자동으로 하이픈이 삽입됩니다)</p>
                            </div>
                            <div>
                                <label className="label">연결 차량 <span className="text-red-500">*</span></label>
                                <select
                                    value={form.vehicleId}
                                    onChange={e => setForm({ ...form, vehicleId: e.target.value })}
                                    className="input min-h-[48px]"
                                    required
                                >
                                    <option value="">차량을 선택하세요</option>
                                    {availableVehicles.map(v => (
                                        <option key={v.id} value={v.id}>
                                            {v.displayName} ({v.plateNumber})
                                        </option>
                                    ))}
                                </select>
                                {availableVehicles.length === 0 && (
                                    <p className="text-xs text-amber-500 mt-1">모든 차량에 하이패스가 연결되어 있습니다</p>
                                )}
                            </div>
                            <div>
                                <label className="label">현재 잔액 (원)</label>
                                <input
                                    type="number" value={form.balance}
                                    onChange={e => setForm({ ...form, balance: e.target.value })}
                                    className="input min-h-[48px]" placeholder="0" min="0"
                                />
                                <p className="text-xs text-surface-400 mt-1">하이패스 카드의 현재 충전 잔액</p>
                            </div>
                            <div>
                                <label className="label">메모 (선택)</label>
                                <input
                                    type="text" value={form.memo}
                                    onChange={e => setForm({ ...form, memo: e.target.value })}
                                    className="input min-h-[48px]" placeholder="비고 사항"
                                />
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={resetForm} className="btn-secondary flex-1 min-h-[48px]">취소</button>
                                <button type="submit" disabled={formLoading} className="btn-primary flex-1 min-h-[48px]">
                                    {formLoading ? (<><div className="w-4 h-4 spinner" />저장 중...</>) : editingCard ? '수정' : '등록'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* 카드 목록 */}
            {cards.length === 0 ? (
                <div className="glass-card p-12 text-center">
                    <svg className="w-16 h-16 mx-auto text-surface-200 dark:text-surface-700 mb-4" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
                    </svg>
                    <p className="text-surface-400 dark:text-surface-500 text-lg font-medium">등록된 하이패스가 없습니다</p>
                    <p className="text-sm text-surface-300 dark:text-surface-500 mt-1">하이패스 카드를 등록하고 차량에 연결하세요</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {cards.map(card => {
                        const vehicle = getVehicleById(card.vehicleId);
                        const vehicleIcon = vehicle?.vehicleType ? (VEHICLE_TYPE_ICONS[vehicle.vehicleType] || '🚗') : '🚗';
                        const vehicleBg = vehicle ? getVehicleColor(vehicle.id) : 'bg-surface-200 dark:bg-surface-700';
                        return (
                            <div key={card.id} className="glass-card p-5 transition-all group hover:shadow-glass-lg">
                                <div className="flex items-start justify-between mb-3">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-12 h-12 ${vehicleBg} rounded-xl flex items-center justify-center text-2xl group-hover:scale-110 transition-transform`}>
                                            {vehicleIcon}
                                        </div>
                                        <div>
                                            <h3 className="font-semibold text-surface-900 dark:text-surface-100">
                                                {card.vehicleName || vehicle?.displayName || '(차량 미연결)'}
                                            </h3>
                                            <p className="text-sm text-surface-400 dark:text-surface-500 font-mono">
                                                💳 {card.cardNumber}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={() => handleEdit(card)} className="btn-icon btn-sm text-surface-400 dark:text-surface-500 hover:text-primary-600 dark:hover:text-primary-400 min-h-[48px] min-w-[48px]">
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
                                            </svg>
                                        </button>
                                        <button onClick={() => openDeleteModal(card)} className="btn-icon btn-sm text-surface-400 dark:text-surface-500 hover:text-red-500 dark:hover:text-red-400 min-h-[48px] min-w-[48px]">
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-surface-400 dark:text-surface-500">{card.memo}</span>
                                    <span className={`text-lg font-bold ${
                                        card.balance <= 5000
                                            ? 'text-red-500 dark:text-red-400'
                                            : card.balance <= 20000
                                                ? 'text-amber-500 dark:text-amber-400'
                                                : 'text-accent-600 dark:text-accent-400'
                                    }`}>
                                        {card.balance.toLocaleString()}원
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* 삭제 확인 모달 */}
            <ConfirmModal
                open={modal?.type === 'delete'}
                title="하이패스 삭제"
                message={`"${modal?.card?.cardNumber}" 하이패스를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`}
                confirmText="삭제"
                confirmColor="danger"
                onConfirm={confirmDelete}
                onCancel={closeModal}
            />
        </div>
    );
}
