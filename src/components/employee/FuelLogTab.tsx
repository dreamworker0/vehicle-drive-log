/**
 * FuelLogTab — 직원용 주유 기록 탭
 * 상단: 입력 폼 (카드 그리드 차량 선택 + OCR 촬영), 하단: 기관 전체 주유 기록 리스트
 */
import useFuelLog from '../../hooks/useFuelLog';
import { VEHICLE_TYPE_ICONS } from '../../lib/constants';
import { SkeletonBox, SkeletonList } from '../common/Skeleton';
import VehicleSelector from './VehicleSelector';

export default function FuelLogTab() {
    const {
        vehicles, loading, showForm, setShowForm,
        saving, form, setForm, enrichedRecords,
        totalCost, totalAmount, selectedVehicleKm,
        editingId, handleEdit, handleCancelEdit,
        handleSubmit, handleDelete, handleVehicleSelect,
        currentUid,
        ocrLoading, ocrError, ocrSuccess, cameraInputRef, handleOcrCapture,
    } = useFuelLog();

    if (loading) {
        return (
            <div className="max-w-lg mx-auto animate-fade-in">
                <SkeletonBox className="h-7 w-36 mb-1" />
                <SkeletonBox className="h-4 w-24 mb-6" />
                <SkeletonList count={3} />
            </div>
        );
    }

    return (
        <div className="max-w-lg mx-auto animate-fade-in">
            {/* 헤더 */}
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100">주유 기록</h1>
                    <p className="text-xs text-surface-400 mt-0.5">
                        {enrichedRecords.length}건
                        {totalAmount > 0 && ` · ${totalAmount.toLocaleString()}L`}
                        {totalCost > 0 && ` · ${totalCost.toLocaleString()}원`}
                    </p>
                </div>
                <button
                    onClick={() => {
                        if (showForm) { handleCancelEdit(); } else { setShowForm(true); }
                    }}
                    className="btn-primary btn-sm flex items-center gap-1"
                >
                    {showForm ? '✕ 닫기' : '⛽ 주유 등록'}
                </button>
            </div>

            {/* 입력 폼 */}
            {showForm && (
                <form onSubmit={handleSubmit} className="glass-card p-4 mb-4 space-y-3 animate-fade-in">
                    <h2 className="font-semibold text-sm text-surface-800 dark:text-surface-200">
                        {editingId ? '✏️ 주유 기록 수정' : '새 주유 기록'}
                    </h2>

                    {/* 차량 선택 — VehicleSelector 재사용 */}
                    <div>
                        <label className="label text-xs">차량 <span className="text-red-500">*</span></label>
                        <VehicleSelector
                            vehicles={vehicles}
                            selectedVehicleId={form.vehicleId}
                            onSelect={handleVehicleSelect}
                        />
                    </div>

                    {/* 날짜 */}
                    <div>
                        <label className="label text-xs">날짜 <span className="text-red-500">*</span></label>
                        <input
                            type="date"
                            value={form.date}
                            onChange={e => setForm({ ...form, date: e.target.value })}
                            className="input"
                            required
                        />
                    </div>

                    {/* 주유미터 (현재 km) + 촬영 버튼 */}
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <label className="label text-xs mb-0">주유미터 (현재 km) <span className="text-red-500">*</span></label>
                            <button
                                type="button"
                                onClick={() => cameraInputRef.current?.click()}
                                disabled={ocrLoading}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-700 hover:bg-primary-100 dark:hover:bg-primary-800/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {ocrLoading ? (
                                    <>
                                        <div className="w-3.5 h-3.5 spinner" />
                                        인식 중...
                                    </>
                                ) : (
                                    <>
                                        📷 계기판 촬영
                                    </>
                                )}
                            </button>
                            <input
                                ref={cameraInputRef}
                                type="file"
                                accept="image/*"
                                capture="environment"
                                className="hidden"
                                onChange={handleOcrCapture}
                            />
                        </div>
                        <input
                            type="number"
                            value={form.meterReading}
                            onChange={e => setForm({ ...form, meterReading: e.target.value })}
                            className="input"
                            placeholder="45000"
                            required
                        />
                        {selectedVehicleKm > 0 && (
                            <p className="text-xs text-surface-400 mt-1">
                                📍 현재 누적: <span className="font-medium">{selectedVehicleKm.toLocaleString()} km</span>
                            </p>
                        )}
                        {form.meterReading && selectedVehicleKm > 0 && parseInt(form.meterReading) < selectedVehicleKm && (
                            <p className="text-xs text-amber-500 dark:text-amber-400 mt-1">
                                ⚠️ 입력값이 현재 누적 km보다 작습니다
                            </p>
                        )}
                        {ocrLoading && (
                            <p className="text-xs text-primary mt-1 animate-pulse">📷 계기판 인식 중...</p>
                        )}
                        {ocrSuccess && (
                            <p className="text-xs text-emerald-500 mt-1">✅ 계기판 인식 완료</p>
                        )}
                        {ocrError && (
                            <p className="text-xs text-red-500 mt-1">{ocrError}</p>
                        )}
                    </div>

                    {/* 주유량 + 주유금액 */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="label text-xs">주유량 (L) <span className="text-red-500">*</span></label>
                            <input
                                type="number"
                                step="0.01"
                                value={form.fuelAmount}
                                onChange={e => setForm({ ...form, fuelAmount: e.target.value })}
                                className="input"
                                placeholder="40.5"
                                required
                            />
                        </div>
                        <div>
                            <label className="label text-xs">주유금액 (원) <span className="text-red-500">*</span></label>
                            <input
                                type="number"
                                value={form.fuelCost}
                                onChange={e => setForm({ ...form, fuelCost: e.target.value })}
                                className="input"
                                placeholder="65000"
                                required
                            />
                        </div>
                    </div>

                    {/* 비고 */}
                    <div>
                        <label className="label text-xs">비고</label>
                        <textarea
                            value={form.notes}
                            onChange={e => setForm({ ...form, notes: e.target.value })}
                            className="input min-h-[60px] resize-none"
                            placeholder="특이사항이 있으면 작성해주세요"
                            rows={2}
                        />
                    </div>

                    <div className="flex justify-end gap-2 pt-1">
                        {editingId && (
                            <button type="button" onClick={handleCancelEdit} className="btn-secondary btn-sm">
                                취소
                            </button>
                        )}
                        <button type="submit" disabled={saving} className="btn-primary btn-sm">
                            {saving ? '저장 중...' : editingId ? '수정 완료' : '주유 기록 저장'}
                        </button>
                    </div>
                </form>
            )}

            {/* 기록 리스트 (기관 전체) */}
            {enrichedRecords.length === 0 ? (
                <div className="glass-card p-12 text-center">
                    <div className="text-4xl mb-3">⛽</div>
                    <p className="text-surface-400 font-medium">주유 기록이 없습니다</p>
                    <p className="text-sm text-surface-300 mt-1">위의 버튼으로 새 기록을 등록하세요</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {enrichedRecords.map(rec => {
                        const vehicleIcon = rec.vehicleType ? (VEHICLE_TYPE_ICONS[rec.vehicleType] || '🚗') : '🚗';
                        const isOwn = rec.driverUid === currentUid;
                        return (
                            <div
                                key={rec.id}
                                onClick={() => isOwn && handleEdit(rec)}
                                className={`glass-card p-3.5 flex items-center gap-3 transition-all
                                    ${isOwn ? 'cursor-pointer hover:ring-2 hover:ring-primary/30 active:scale-[0.99]' : ''}
                                    ${editingId === rec.id ? 'ring-2 ring-primary' : ''}`}
                            >
                                {/* 차량 아이콘 */}
                                <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center text-lg flex-shrink-0">
                                    {vehicleIcon}
                                </div>

                                {/* 정보 */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-sm text-surface-900 dark:text-surface-100">{rec.vehicleName}</span>
                                        <span className="text-xs text-surface-400">{rec.driverName}</span>
                                    </div>
                                    <p className="text-xs text-surface-400 mt-0.5">
                                        {rec.date} · {rec.meterReading?.toLocaleString()} km
                                    </p>
                                </div>

                                {/* 금액/리터 + 삭제 */}
                                <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                                    <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                                        {rec.fuelAmount}L
                                    </span>
                                    <span className="text-xs text-surface-500 dark:text-surface-400">
                                        {rec.fuelCost?.toLocaleString()}원
                                    </span>
                                    {isOwn && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleDelete(rec); }}
                                            className="text-[10px] text-surface-300 hover:text-red-500 transition-colors mt-0.5"
                                        >
                                            삭제
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
