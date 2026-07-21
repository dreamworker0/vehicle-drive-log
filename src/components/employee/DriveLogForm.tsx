import { useState, useEffect } from 'react';
import useDriveLogForm from '../../hooks/useDriveLogForm';
import { useAuth } from '../../hooks/useAuth';
import useVehiclePriority from '../../hooks/useVehiclePriority';
import MileageInput from './MileageInput';
import ConfirmModal from '../common/ConfirmModal';
import type { DriveLog } from '../../types/driveLog';

// 하위 레이아웃 컴포넌트 임포트
import VehicleInfoSection from './driveLogFormLayout/VehicleInfoSection';
import DateSection from './driveLogFormLayout/DateSection';
import WaypointSection from './driveLogFormLayout/WaypointSection';
import DriverSection from './driveLogFormLayout/DriverSection';
import PassengerSection from './driveLogFormLayout/PassengerSection';
import VehicleStatusSection from './driveLogFormLayout/VehicleStatusSection';

export default function DriveLogForm() {
    const {
        form, setForm,
        vehicles, favorites, members,
        loading, submitting, success,
        selectedPassengers, selectedVehicle,
        selectedCoDrivers,
        externalCoDriverNames, setExternalCoDriverNames,
        toggleCoDriver,
        handleSelectDriver,
        driverCandidates,
        driverEligibleMembers,
        canEditDriver,
        isElectric,
        reservationData,
        editLog, isEditMode, isRetroactive, retroEntry,
        showFavSave, setShowFavSave,
        favName, setFavName,
        hipassCard,
        lastEndBattery,
        lastDriveLog,
        nextDriveLog,
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
        kmRangeError,
        handleDismissKmRangeError,
        handleConfirmStartKm,
        handleCancelConfirm,
    } = useDriveLogForm();
    const { orgFeatures } = useAuth();
    const { usageCounts } = useVehiclePriority();

    // 비고 접기/펼치기 상태 (기본값: 접힘 — 자주 사용하지 않는 항목)
    const [isNotesExpanded, setIsNotesExpanded] = useState(() => {
        try {
            const saved = localStorage.getItem('driveLog_notesExpanded');
            return saved !== null ? JSON.parse(saved) : false;
        } catch {
            return false;
        }
    });

    useEffect(() => {
        localStorage.setItem('driveLog_notesExpanded', JSON.stringify(isNotesExpanded));
    }, [isNotesExpanded]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 spinner" />
            </div>
        );
    }

    // 제목 결정
    const title = isEditMode ? '운행일지 수정' : retroEntry ? '누락 운행 소급 입력' : '운행일지 작성';

    const subtitle = isEditMode
        ? `${(editLog as DriveLog).vehicleName || '차량'} · ${(editLog as DriveLog).destination || ''} 기록을 수정합니다`
        : retroEntry
            ? '예약 없이 지난 운행을 소급하여 직접 기록합니다'
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
                    <svg aria-hidden="true" className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                    {isEditMode ? '운행일지가 수정되었습니다!' : '운행일지가 저장되었습니다!'}
                </div>
            )}

            {retroEntry && (
                <div className="mb-4 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-xs leading-relaxed animate-fade-in">
                    <p className="font-semibold mb-1">📌 누락 운행 소급 입력 안내</p>
                    <p>차량과 운행 일자를 고르면 <strong>그 날짜 직전 기록의 도착 km</strong>가 출발 km로 자동 입력됩니다.</p>
                    <p className="mt-0.5">계기판 숫자가 어긋나지 않도록, <strong>도착 km는 아래 표시되는 "직후 운전 정보"의 출발 km에 맞춰</strong> 입력하세요.</p>
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

                {/* 2. 운행 일자 섹션 (수정 모드 또는 누락 소급 입력 모드) */}
                {(isEditMode || retroEntry) && (
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
                    onStartKmChange={(value) => setForm({ ...form, startKm: value })}
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
                    lastDriveLog={lastDriveLog}
                    nextDriveLog={nextDriveLog}
                />

                {/* 4-1. 운전자 섹션 (대표 운전자 + 공동 운전자) — 기관 설정에 따라 표시 */}
                {(orgFeatures.driverSelection || orgFeatures.coDriver) && (
                    <DriverSection
                        driverCandidates={driverCandidates}
                        driverUid={form.driverUid}
                        onSelectDriver={handleSelectDriver}
                        canEditDriver={canEditDriver}
                        driverSelectionEnabled={orgFeatures.driverSelection}
                        coDriverEnabled={orgFeatures.coDriver}
                        allowList={orgFeatures.driverAllowList}
                        allowSearch={orgFeatures.driverAllowSearch}
                        members={driverEligibleMembers}
                        selectedCoDrivers={selectedCoDrivers}
                        toggleCoDriver={toggleCoDriver}
                        externalCoDriverNames={externalCoDriverNames}
                        setExternalCoDriverNames={setExternalCoDriverNames}
                    />
                )}

                {/* 5. 동승자 섹션 — 기관 설정에 따라 표시 */}
                {orgFeatures.passenger && (
                    <PassengerSection
                        allowList={orgFeatures.passengerAllowList}
                        allowSearch={orgFeatures.passengerAllowSearch}
                        allowCount={orgFeatures.passengerAllowCount}
                        members={members}
                        selectedPassengers={selectedPassengers}
                        externalPassengerCount={externalPassengerCount}
                        externalPassengerNames={externalPassengerNames}
                        togglePassenger={togglePassenger}
                        setExternalPassengerCount={setExternalPassengerCount}
                        setExternalPassengerNames={setExternalPassengerNames}
                    />
                )}

                {/* 6. 차량 상태 섹션 (배터리/하이패스) */}
                <VehicleStatusSection
                    isElectric={isElectric}
                    form={form}
                    setForm={setForm}
                    lastEndBattery={lastEndBattery}
                    hipassCard={hipassCard}
                    hipassEnabled={orgFeatures.hipass}
                />

                {/* 7. 비고 섹션 */}
                <div className="glass-card p-4">
                    <div className={`flex items-center justify-between ${isNotesExpanded ? 'mb-3' : ''}`}>
                        <label htmlFor="notes" className="label mb-0 flex items-center gap-2">
                            📝 비고
                            {!isNotesExpanded && form.notes.trim() !== '' && (
                                <span className="text-xs font-normal text-surface-500 dark:text-surface-400 truncate max-w-[120px] sm:max-w-[200px]">
                                    {form.notes}
                                </span>
                            )}
                        </label>
                        <button
                            type="button"
                            onClick={() => setIsNotesExpanded(!isNotesExpanded)}
                            className="text-xs px-3 py-2 min-h-[48px] rounded-md bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors flex items-center justify-center font-medium"
                        >
                            {isNotesExpanded ? '닫기 ▲' : '열기 ▼'}
                        </button>
                    </div>
                    {isNotesExpanded && (
                        <textarea
                            id="notes"
                            value={form.notes}
                            onChange={e => setForm({ ...form, notes: e.target.value })}
                            className="input min-h-[80px] resize-none"
                            placeholder="특이사항이 있으면 작성해주세요"
                            rows={3}
                        />
                    )}
                </div>

                {/* 제출 버튼 */}
                <button
                    type="submit"
                    disabled={submitting || !form.vehicleId || !form.startKm || !form.endKm || (!!form.startKm && !!form.endKm && Number(form.endKm) < Number(form.startKm))}
                    className="w-full btn-primary min-h-[48px]"
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
                title="출발 주행거리 일치 확인"
                message={`직전 운행 기록이 ${confirmStartKm?.suggested?.toLocaleString()} km로 끝났습니다.\n\n입력하신 ${confirmStartKm?.original?.toLocaleString()} km 대신, 직전 기록인 ${confirmStartKm?.suggested?.toLocaleString()} km에 맞춰 일치시켜 저장하시겠습니까?`}
                confirmText="일치시켜 저장"
                cancelText="취소"
                onConfirm={handleConfirmStartKm}
                onCancel={handleCancelConfirm}
            />

            <ConfirmModal
                open={!!kmRangeError}
                title="⚠️ 주행거리 범위 오류"
                message={kmRangeError || ''}
                confirmText="확인"
                cancelText=""
                confirmColor="warning"
                onConfirm={handleDismissKmRangeError}
                onCancel={handleDismissKmRangeError}
            />
        </div>
    );
}
