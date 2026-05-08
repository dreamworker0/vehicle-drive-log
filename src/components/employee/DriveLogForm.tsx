import useDriveLogForm from '../../hooks/useDriveLogForm';
import useVehiclePriority from '../../hooks/useVehiclePriority';
import MileageInput from './MileageInput';
import ConfirmModal from '../common/ConfirmModal';
import type { DriveLog } from '../../types/driveLog';

// 하위 레이아웃 컴포넌트 임포트
import VehicleInfoSection from './driveLogFormLayout/VehicleInfoSection';
import DateSection from './driveLogFormLayout/DateSection';
import WaypointSection from './driveLogFormLayout/WaypointSection';
import PassengerSection from './driveLogFormLayout/PassengerSection';
import VehicleStatusSection from './driveLogFormLayout/VehicleStatusSection';

export default function DriveLogForm() {
    const {
        form, setForm,
        vehicles, favorites, members,
        loading, submitting, success,
        selectedPassengers, selectedVehicle,
        isElectric,
        reservationData,
        editLog, isEditMode, isRetroactive,
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
        externalPassengerNames, setExternalPassengerNames,
        handleOcrCapture,
        handleOcrReport,
        handleSubmit,
        confirmStartKm,
        handleConfirmStartKm,
        handleCancelConfirm,
    } = useDriveLogForm();
    const { usageCounts } = useVehiclePriority();

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 spinner" />
            </div>
        );
    }

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

                {/* 1. 차량 정보 섹션 */}
                <VehicleInfoSection
                    reservationData={reservationData}
                    isEditMode={isEditMode}
                    form={form}
                    selectedVehicle={selectedVehicle}
                    vehicles={vehicles}
                    usageCounts={usageCounts}
                    handleVehicleSelect={handleVehicleSelect}
                />

                {/* 2. 운행 일자 섹션 (수정 모드 시) */}
                {isEditMode && (
                    <DateSection
                        form={form}
                        setForm={setForm}
                        isRetroactive={isRetroactive}
                    />
                )}

                {/* 3. 목적 및 행선지 섹션 */}
                <WaypointSection
                    reservationData={reservationData}
                    isEditMode={isEditMode}
                    form={form}
                    setForm={setForm}
                    favorites={favorites}
                    showFavSave={showFavSave}
                    setShowFavSave={setShowFavSave}
                    favName={favName}
                    setFavName={setFavName}
                    handleFavoriteSelect={handleFavoriteSelect}
                    handleSaveFavorite={handleSaveFavorite}
                />

                {/* 4. 주행 거리 입력 섹션 */}
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

                {/* 5. 동승자 섹션 */}
                <PassengerSection
                    members={members}
                    selectedPassengers={selectedPassengers}
                    externalPassengerCount={externalPassengerCount}
                    externalPassengerNames={externalPassengerNames}
                    togglePassenger={togglePassenger}
                    setExternalPassengerCount={setExternalPassengerCount}
                    setExternalPassengerNames={setExternalPassengerNames}
                />

                {/* 6. 차량 상태 섹션 (배터리/하이패스) */}
                <VehicleStatusSection
                    isElectric={isElectric}
                    form={form}
                    setForm={setForm}
                    lastEndBattery={lastEndBattery}
                    hipassCard={hipassCard}
                />

                {/* 7. 비고 섹션 */}
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

                {/* 제출 버튼 */}
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

            <ConfirmModal
                open={!!confirmStartKm}
                title="출발 주행거리 보정 안내"
                message={`직전 운행 기록이 ${confirmStartKm?.suggested?.toLocaleString()} km로 끝났습니다.\n\n입력하신 ${confirmStartKm?.original?.toLocaleString()} km 대신, 직전 기록인 ${confirmStartKm?.suggested?.toLocaleString()} km로 자동 보정하여 저장하시겠습니까?`}
                confirmText="보정하여 저장"
                cancelText="취소"
                onConfirm={handleConfirmStartKm}
                onCancel={handleCancelConfirm}
            />
        </div>
    );
}
