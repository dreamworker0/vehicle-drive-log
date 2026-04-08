/**
 * DriveLogForm — 운행일지 작성/수정 폼
 * 로직은 useDriveLogForm 훅으로 분리, UI만 담당
 */
import { VEHICLE_TYPE_ICONS, getVehicleColor } from '../../lib/constants';
import useDriveLogForm from '../../hooks/useDriveLogForm';
import useVehiclePriority from '../../hooks/useVehiclePriority';
import VehicleSelector from './VehicleSelector';
import MileageInput from './MileageInput';
import type { DriveLog } from '../../types/driveLog';
import type { Favorite } from '../../types/favorite';
import { toLocalDateStr } from '../../lib/dateUtils';
import type { User as UserDoc } from '../../types/user';

export default function DriveLogForm() {
    const {
        form, setForm,
        vehicles, favorites, members,
        loading, submitting, success,
        selectedPassengers, selectedVehicle,
        isElectric,
        reservationData,
        editLog, isEditMode,
        showFavSave, setShowFavSave,
        favName, setFavName,
        hipassCard,
        lastEndBattery,
        ocrLoading, ocrError, ocrSuccess, ocrImageUrl,
        ocrReportSending, ocrReportSent,
        cameraInputRef, endKmInputRef,
        handleVehicleSelect,
        handleFavoriteSelect,
        handleSaveFavorite,
        togglePassenger,
        externalPassengerCount, setExternalPassengerCount,
        handleOcrCapture,
        handleOcrReport,
        handleSubmit,
    } = useDriveLogForm();
    const { usageCounts } = useVehiclePriority();

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 spinner" />
            </div>
        );
    }

    const todayStr = toLocalDateStr(new Date());
    const minDateStr = (() => {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        return toLocalDateStr(d);
    })();

    // 제목 결정
    const title = isEditMode ? '운행일지 수정' : '운행일지 작성';

    const subtitle = isEditMode
        ? `${(editLog as DriveLog).vehicleName || '차량'} · ${(editLog as DriveLog).destination || ''} 기록을 수정합니다`
        : '차량 운행 기록을 입력하세요';

    return (
        <div className="max-w-lg mx-auto animate-fade-in">
            <h1 className="text-lg font-bold text-surface-900 dark:text-surface-100 mb-2">
                {title}
            </h1>
            <p className="text-sm text-surface-500 dark:text-surface-400 mb-6">
                {subtitle}
            </p>

            {success && (
                <div className="mb-4 p-4 rounded-xl bg-accent-50 dark:bg-accent-900/20 border border-accent-200 dark:border-accent-800 text-accent-700 dark:text-accent-400 text-sm flex items-center gap-2 animate-fade-in">
                    <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                    {isEditMode ? '운행일지가 수정되었습니다!' : '운행일지가 저장되었습니다!'}
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">



                {/* 차량 선택 */}
                {reservationData?.vehicleId || isEditMode ? (
                    <div className="glass-card p-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <span className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl ${getVehicleColor(form.vehicleId)}`}>
                                    {(selectedVehicle?.vehicleType ? VEHICLE_TYPE_ICONS[selectedVehicle.vehicleType] : undefined) || '🚗'}
                                </span>
                                <div>
                                    <p className="font-semibold text-surface-900 dark:text-surface-100">{form.vehicleName}</p>
                                    <p className="text-xs text-surface-400">
                                        {isEditMode ? '수정 중인 차량' : '예약 배정 차량'}
                                    </p>
                                </div>
                            </div>
                            {form.startTime && (
                                <div className="text-right">
                                    <p className="text-lg font-bold text-primary-600">{form.startTime}</p>
                                    <p className="text-xs text-surface-400">출발 시각</p>
                                </div>
                            )}
                        </div>
                        {reservationData && (form.purpose || form.destination) && (
                            <div className="mt-3 pt-3 border-t border-surface-100 dark:border-surface-700 grid grid-cols-2 gap-4">
                                {form.purpose && (
                                    <div>
                                        <p className="text-xs text-surface-400">운행 목적</p>
                                        <p className="text-sm font-medium text-surface-800 dark:text-surface-200">{form.purpose}</p>
                                    </div>
                                )}
                                {form.destination && (
                                    <div>
                                        <p className="text-xs text-surface-400">행선지</p>
                                        <p className="text-sm font-medium text-surface-800 dark:text-surface-200">{form.destination}</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    <div>
                        <label className="label">차량 선택 <span className="text-red-500">*</span></label>
                        <VehicleSelector
                            vehicles={vehicles}
                            selectedVehicleId={form.vehicleId}
                            onSelect={handleVehicleSelect}
                            usageCounts={usageCounts}
                        />
                    </div>
                )}



                {/* 운행 일자 및 시간 */}
                <div className="glass-card p-4">
                    <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-3">🕐 운행 시간</h3>
                    <div className="mb-4">
                        <label htmlFor="driveDate" className="label text-xs">운행 일자</label>
                        <input
                            id="driveDate"
                            type="date"
                            value={form.driveDate}
                            min={minDateStr}
                            max={todayStr}
                            onChange={e => setForm({ ...form, driveDate: e.target.value })}
                            className="input"
                        />
                        <p className="text-[11px] text-surface-400 mt-1">일주일 이내의 날짜만 선택할 수 있습니다.</p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="startTime" className="label text-xs">출발 시각</label>
                            <input
                                id="startTime"
                                type="time"
                                value={form.startTime}
                                onChange={e => setForm({ ...form, startTime: e.target.value })}
                                className="input"
                            />
                        </div>
                        <div>
                            <label htmlFor="endTime" className="label text-xs">도착 시각</label>
                            <input
                                id="endTime"
                                type="time"
                                value={form.endTime}
                                onChange={e => setForm({ ...form, endTime: e.target.value })}
                                className="input"
                            />
                        </div>
                    </div>
                </div>

                {/* 운행 목적 & 행선지 - 예약 없이 직접 작성 시 또는 수정 모드 */}
                {(!reservationData?.vehicleId || isEditMode) && (
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="purpose" className="label">운행 목적</label>
                            <input
                                id="purpose"
                                type="text"
                                value={form.purpose}
                                onChange={e => setForm({ ...form, purpose: e.target.value })}
                                className="input"
                                placeholder="출장"
                            />
                        </div>
                        <div>
                            <label htmlFor="destination" className="label">행선지</label>
                            <div className="flex items-center gap-1.5">
                                <input
                                    id="destination"
                                    type="text"
                                    value={form.destination}
                                    onChange={e => setForm({ ...form, destination: e.target.value })}
                                    className="input flex-1"
                                    placeholder="서울시청"
                                />
                                {/* 즐겨찾기 저장 아이콘 버튼 */}
                                {form.destination.trim() && !favorites.some((f: Favorite) => f.address === form.destination.trim() || f.name === form.destination.trim()) && (
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
                                <div className="mt-2 p-3 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800 animate-fade-in">
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="text"
                                            value={favName}
                                            onChange={e => setFavName(e.target.value)}
                                            className="input flex-1 text-sm py-1.5"
                                            placeholder="별칭 (예: 김OO 어르신 댁)"
                                            aria-label="즐겨찾기 별칭"
                                        />
                                        <button
                                            type="button"
                                            onClick={handleSaveFavorite}
                                            className="btn-primary btn-sm whitespace-nowrap"
                                        >
                                            저장
                                        </button>
                                    </div>
                                </div>
                            )}
                            {/* 즐겨찾기 칩 */}
                            {favorites.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                    {favorites.map((fav: Favorite) => (
                                        <button
                                            key={fav.id}
                                            type="button"
                                            onClick={() => handleFavoriteSelect(fav)}
                                            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${form.destination === (fav.address || fav.name)
                                                ? 'bg-amber-100 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400'
                                                : 'bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:border-amber-300 hover:bg-amber-50'
                                                }`}
                                        >
                                            ⭐ {fav.name}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* 주행 거리 */}
                <MileageInput
                    form={form}
                    onEndKmChange={(value) => setForm({ ...form, endKm: value })}
                    ocrLoading={ocrLoading}
                    ocrError={ocrError}
                    ocrSuccess={ocrSuccess}
                    ocrImageUrl={ocrImageUrl}
                    ocrReportSending={ocrReportSending}
                    ocrReportSent={ocrReportSent}
                    cameraInputRef={cameraInputRef}
                    onOcrCapture={handleOcrCapture}
                    onOcrReport={handleOcrReport}
                    vehicleSelected={!!form.vehicleId}
                    endKmRef={endKmInputRef}
                />

                {/* 동승자 선택 */}
                <div className="glass-card p-4">
                    <label className="label">
                        🧑‍🤝‍🧑 동승자
                        {(selectedPassengers.length + externalPassengerCount) > 0 && (
                            <span className="ml-2 text-primary-600 font-bold">
                                {selectedPassengers.length + externalPassengerCount}명
                            </span>
                        )}
                    </label>
                    {/* 조직원 칩 */}
                    {members.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-3">
                            {members.map((m: UserDoc) => {
                                const isSelected = selectedPassengers.some((p: UserDoc) => p.id === m.id);
                                return (
                                    <button
                                        key={m.id}
                                        type="button"
                                        onClick={() => togglePassenger(m)}
                                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${isSelected
                                            ? 'bg-primary-100 border-primary-300 text-primary-700 ring-1 ring-primary-200'
                                            : 'bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:border-primary-300'
                                            }`}
                                    >
                                        {isSelected && '✓ '}{m.name || m.email?.split('@')[0]}
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {/* 외부 인원 */}
                    <div className="flex items-center gap-3">
                        <p className="text-xs text-surface-500 dark:text-surface-400 whitespace-nowrap">외부 인원</p>
                        <div className="flex items-center gap-1.5">
                            <button
                                type="button"
                                onClick={() => setExternalPassengerCount(Math.max(0, externalPassengerCount - 1))}
                                disabled={externalPassengerCount <= 0}
                                className="w-8 h-8 rounded-lg border border-surface-200 dark:border-surface-600 flex items-center justify-center text-sm font-bold text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700 disabled:opacity-30 transition-all"
                            >
                                −
                            </button>
                            <span className="w-8 text-center font-bold text-surface-800 dark:text-surface-200">{externalPassengerCount}</span>
                            <button
                                type="button"
                                onClick={() => setExternalPassengerCount(externalPassengerCount + 1)}
                                className="w-8 h-8 rounded-lg border border-surface-200 dark:border-surface-600 flex items-center justify-center text-sm font-bold text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700 transition-all"
                            >
                                +
                            </button>
                            <span className="text-xs text-surface-400">명</span>
                        </div>
                    </div>

                    {/* 총 탑승 인원 */}
                    {(selectedPassengers.length + externalPassengerCount) > 0 && (
                        <div className="mt-3 pt-2.5 border-t border-surface-100 dark:border-surface-700 text-xs text-surface-500 dark:text-surface-400">
                            👥 총 탑승 인원: <span className="font-bold text-surface-700 dark:text-surface-200">{selectedPassengers.length + externalPassengerCount + 1}명</span> (운전자 포함)
                        </div>
                    )}
                </div>

                {/* 배터리 (전기차만) */}
                {isElectric && (
                    <div className="glass-card p-4">
                        <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-3">🔋 배터리</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="batteryStart" className="label text-xs">출발 배터리 %</label>
                                <input
                                    id="batteryStart"
                                    type="number"
                                    min="0" max="100"
                                    value={form.batteryStart}
                                    onChange={e => setForm({ ...form, batteryStart: e.target.value })}
                                    className="input"
                                    placeholder={lastEndBattery != null ? `이전 도착: ${lastEndBattery}%` : '80'}
                                />
                            </div>
                            <div>
                                <label htmlFor="batteryEnd" className="label text-xs">도착 배터리 %</label>
                                <input
                                    id="batteryEnd"
                                    type="number"
                                    min="0" max="100"
                                    value={form.batteryEnd}
                                    onChange={e => setForm({ ...form, batteryEnd: e.target.value })}
                                    className="input"
                                    placeholder="45"
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* 하이패스 (등록된 차량만) */}
                {hipassCard && (
                    <div className="glass-card p-4">
                        <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-3">💳 하이패스</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="label text-xs">사용전 금액</label>
                                <div className="input bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400 cursor-not-allowed" aria-label="하이패스 사용전 금액">
                                    {hipassCard.balance.toLocaleString()}원
                                </div>
                            </div>
                            <div>
                                <label htmlFor="hipassAfter" className="label text-xs">사용후 금액</label>
                                <input
                                    id="hipassAfter"
                                    type="number"
                                    value={form.hipassBalanceAfter}
                                    onChange={e => setForm({ ...form, hipassBalanceAfter: e.target.value })}
                                    className="input"
                                    placeholder={hipassCard.balance.toLocaleString()}
                                    min="0"
                                />
                            </div>
                        </div>
                        {form.hipassBalanceAfter !== '' && (
                            <div className="mt-3 flex items-center justify-between px-1">
                                <span className="text-xs text-surface-400">
                                    사용 금액: <span className="font-bold text-red-500">-{(hipassCard.balance - Number(form.hipassBalanceAfter)).toLocaleString()}원</span>
                                </span>
                                <span className={`text-sm font-bold ${
                                    Number(form.hipassBalanceAfter) <= 5000
                                        ? 'text-red-500'
                                        : Number(form.hipassBalanceAfter) <= 20000
                                            ? 'text-amber-500'
                                            : 'text-accent-600 dark:text-accent-400'
                                }`}>
                                    잔액: {Number(form.hipassBalanceAfter).toLocaleString()}원
                                </span>
                            </div>
                        )}
                        <p className="text-xs text-surface-400 mt-2">하이패스 사용 시 사용후 금액을 입력하면 잔액이 자동으로 업데이트됩니다</p>
                    </div>
                )}

                {/* 비고 */}
                <div className="glass-card p-4">
                    <label htmlFor="notes" className="label">📝 비고</label>
                    <textarea
                        id="notes"
                        value={form.notes}
                        onChange={e => setForm({ ...form, notes: e.target.value })}
                        className="input min-h-[80px] resize-none"
                        placeholder="특이사항이 있으면 작성해주세요"
                        rows={3}
                    />
                </div>

                {/* 제출 */}
                <button
                    type="submit"
                    disabled={submitting || !form.vehicleId || !form.startKm || !form.endKm}
                    className="w-full btn-primary"
                >
                    {submitting ? (
                        <>
                            <div className="w-5 h-5 spinner" />
                            {isEditMode ? '수정 중...' : '저장 중...'}
                        </>
                    ) : isEditMode ? '운행일지 수정' : '운행일지 저장'}
                </button>
            </form>
        </div>
    );
}
