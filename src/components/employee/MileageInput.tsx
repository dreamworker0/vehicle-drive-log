/**
 * MileageInput — 주행 거리 입력 + OCR 계기판 촬영
 * DriveLogForm에서 추출된 서브 컴포넌트
 */
/* eslint-disable @typescript-eslint/no-unused-vars */
import React from 'react';
import type { DriveLog } from '../../types/driveLog';

interface MileageForm {
    startKm: string;
    endKm: string;
}

interface MileageInputProps {
    form: MileageForm;
    onStartKmChange: (value: string) => void;
    onEndKmChange: (value: string) => void;
    ocrLoading: boolean;
    ocrError: string;
    ocrSuccess: boolean;
    ocrImageUrl?: string | null;
    ocrReportSending: boolean;
    ocrReportSent: boolean;
    cameraInputRef: React.RefObject<HTMLInputElement | null>;
    onOcrCapture: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onOcrReport?: () => void;
    vehicleSelected: boolean;
    endKmRef?: React.RefObject<HTMLInputElement | null>;
    lastDriveLog?: DriveLog | null;
    nextDriveLog?: DriveLog | null;
}

export default function MileageInput({
    form,
    onStartKmChange,
    onEndKmChange,
    ocrLoading,
    ocrError,
    ocrSuccess,
    ocrImageUrl,
    ocrReportSending,
    ocrReportSent,
    cameraInputRef,
    onOcrCapture,
    onOcrReport,
    vehicleSelected,
    endKmRef,
    lastDriveLog,
    nextDriveLog,
}: MileageInputProps) {
    return (
        <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-surface-600 dark:text-surface-400">🛣️ 주행 거리</h3>
                <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    disabled={ocrLoading || !vehicleSelected}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-700 hover:bg-primary-100 dark:hover:bg-primary-800/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px]"
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
                    onChange={onOcrCapture}
                    className="hidden"
                />
            </div>
            {/* 원본 촬영 이미지 숨김 처리 (사용자 요청)
              ocrImageUrl && (
                <div className="mb-3 animate-fade-in relative rounded-lg overflow-hidden border border-surface-200 dark:border-surface-700 bg-black max-h-48 flex items-center justify-center">
                    <img src={`data:image/jpeg;base64,${ocrImageUrl}`} alt="계기판 캡처" className="max-w-full max-h-48 object-contain" />
                    <div className="absolute top-0 right-0 left-0 p-2 bg-gradient-to-b from-black/60 to-transparent flex justify-between items-center text-white text-xs">
                        <span className="font-medium drop-shadow-md">원본 촬영 이미지</span>
                    </div>
                </div>
            ) */}
            {ocrError && (
                <div className="mb-3 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-xs text-amber-700 dark:text-amber-300 animate-fade-in">
                    <div className="flex items-center gap-1.5">
                        <span>⚠️ {ocrError}</span>
                    </div>
                    <button
                        type="button"
                        onClick={() => endKmRef?.current?.focus()}
                        className="mt-1 text-amber-800 dark:text-amber-300 font-medium underline min-h-[48px] px-2 py-1 flex items-center justify-center"
                    >
                        수동 입력하기 →
                    </button>
                </div>
            )}
            
            {/* 직전 운전자 정보 노출 배너 */}
            {lastDriveLog && (
                <div className="mb-4 px-3 py-2.5 rounded-xl bg-surface-50 dark:bg-surface-800/60 border border-surface-200 dark:border-surface-700 text-xs text-surface-600 dark:text-surface-400 flex flex-col gap-1 animate-fade-in">
                    <div className="flex items-center justify-between">
                        <span className="font-medium text-surface-700 dark:text-surface-300">ℹ️ 직전 운전 정보</span>
                        <span className="text-[10px] text-surface-400 dark:text-surface-500">비교하여 기록할 수 있습니다</span>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:justify-between text-surface-500 dark:text-surface-400 mt-0.5 gap-1 sm:gap-0">
                        <span>운전자: <strong className="text-surface-800 dark:text-surface-200">{lastDriveLog.driverName || '알 수 없음'}</strong></span>
                        <span>
                            직전 주행: <strong className="text-surface-800 dark:text-surface-200">{lastDriveLog.startKm?.toLocaleString() ?? 0} km</strong> → <strong className="text-surface-800 dark:text-surface-200">{lastDriveLog.endKm?.toLocaleString() ?? 0} km</strong> 
                            <span className="text-primary-600 dark:text-primary-400 ml-1.5 font-medium">
                                (총 {((lastDriveLog.endKm || 0) - (lastDriveLog.startKm || 0)).toLocaleString()} km 주행)
                            </span>
                        </span>
                    </div>
                </div>
            )}

            {/* 직후 운전자 정보 노출 배너 */}
            {nextDriveLog && (
                <div className="mb-4 px-3 py-2.5 rounded-xl bg-surface-50 dark:bg-surface-800/60 border border-surface-200 dark:border-surface-700 text-xs text-surface-600 dark:text-surface-400 flex flex-col gap-1 animate-fade-in">
                    <div className="flex items-center justify-between">
                        <span className="font-medium text-surface-700 dark:text-surface-300">ℹ️ 직후 운전 정보</span>
                        <span className="text-[10px] text-surface-400 dark:text-surface-500">비교하여 기록할 수 있습니다</span>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:justify-between text-surface-500 dark:text-surface-400 mt-0.5 gap-1 sm:gap-0">
                        <span>운전자: <strong className="text-surface-800 dark:text-surface-200">{nextDriveLog.driverName || '알 수 없음'}</strong></span>
                        <span>
                            직후 주행: <strong className="text-surface-800 dark:text-surface-200">{nextDriveLog.startKm?.toLocaleString() ?? 0} km</strong> → <strong className="text-surface-800 dark:text-surface-200">{nextDriveLog.endKm?.toLocaleString() ?? 0} km</strong> 
                            <span className="text-primary-600 dark:text-primary-400 ml-1.5 font-medium">
                                (총 {((nextDriveLog.endKm || 0) - (nextDriveLog.startKm || 0)).toLocaleString()} km 주행)
                            </span>
                        </span>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="label text-xs">출발 km <span className="text-red-500 dark:text-red-400">*</span></label>
                    <input
                        type="number"
                        value={form.startKm}
                        onChange={e => onStartKmChange(e.target.value)}
                        readOnly={!vehicleSelected}
                        className={`input min-h-[48px] ${!vehicleSelected ? 'bg-surface-50 dark:bg-surface-800 text-surface-500 dark:text-surface-400 cursor-not-allowed' : ''}`}
                        placeholder={vehicleSelected ? "출발 km 입력" : "차량 선택 시 자동 입력"}
                        required
                    />
                    {lastDriveLog && form.startKm && Number(form.startKm) < (lastDriveLog.startKm || 0) && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-1 font-medium leading-tight">
                            ⚠️ 직전 출발({lastDriveLog.startKm?.toLocaleString()})보다 낮음
                        </p>
                    )}
                </div>
                <div>
                    <label className="label text-xs">도착 km <span className="text-red-500 dark:text-red-400">*</span></label>
                    <input
                        ref={endKmRef}
                        type="number"
                        value={form.endKm}
                        onChange={e => onEndKmChange(e.target.value)}
                        className="input min-h-[48px]"
                        placeholder="12400"
                        required
                    />
                    {form.startKm && form.endKm && Number(form.endKm) < Number(form.startKm) && (
                        <p className="text-[11px] text-red-500 dark:text-red-400 mt-1 font-medium leading-tight">
                            ⚠️ 도착 km가 출발 km({Number(form.startKm).toLocaleString()})보다 작아요
                        </p>
                    )}
                    {nextDriveLog && form.endKm && Number(form.endKm) > (nextDriveLog.endKm || 0) && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-1 font-medium leading-tight">
                            ⚠️ 직후 도착({nextDriveLog.endKm?.toLocaleString()})보다 높음
                        </p>
                    )}
                </div>
            </div>
            {form.startKm && form.endKm && Number(form.endKm) >= Number(form.startKm) && (
                <div className="mt-3 text-center">
                    <span className="text-lg font-bold text-primary-600 dark:text-primary-400">
                        {(Number(form.endKm) - Number(form.startKm)).toLocaleString()} km
                    </span>
                    <span className="text-sm text-surface-400 dark:text-surface-500 ml-1">주행</span>
                </div>
            )}
        </div>
    );
}
