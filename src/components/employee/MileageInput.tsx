/**
 * MileageInput — 주행 거리 입력 + OCR 계기판 촬영
 * DriveLogForm에서 추출된 서브 컴포넌트
 */
/* eslint-disable @typescript-eslint/no-unused-vars */
import React from 'react';

interface MileageForm {
    startKm: string;
    endKm: string;
}

interface MileageInputProps {
    form: MileageForm;
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
}

export default function MileageInput({
    form,
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
}: MileageInputProps) {
    return (
        <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-surface-600 dark:text-surface-400">🛣️ 주행 거리</h3>
                <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    disabled={ocrLoading || !vehicleSelected}
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
                        className="mt-1 text-amber-800 dark:text-amber-300 font-medium underline"
                    >
                        수동 입력하기 →
                    </button>
                </div>
            )}
            {/* 인식 오류 신고 기능 제외 (사용자 요청)
              ocrSuccess && (
                <div className="mb-3 space-y-2 animate-fade-in">

                    {onOcrReport && !ocrReportSent && (
                        <button
                            type="button"
                            onClick={onOcrReport}
                            disabled={ocrReportSending}
                            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 border border-surface-200 dark:border-surface-700 transition-colors disabled:opacity-50"
                        >
                            {ocrReportSending ? (
                                <>
                                    <div className="w-3 h-3 spinner" />
                                    전송 중...
                                </>
                            ) : (
                                <>
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                                    </svg>
                                    인식 오류 보내기
                                </>
                            )}
                        </button>
                    )}

                </div>
            ) */}
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="label text-xs">출발 km <span className="text-red-500">*</span></label>
                    <input
                        type="number"
                        value={form.startKm}
                        readOnly
                        className="input bg-surface-50 dark:bg-surface-800 text-surface-500 dark:text-surface-400 cursor-not-allowed"
                        placeholder="차량 선택 시 자동 입력"
                        required
                    />
                </div>
                <div>
                    <label className="label text-xs">도착 km <span className="text-red-500">*</span></label>
                    <input
                        ref={endKmRef}
                        type="number"
                        value={form.endKm}
                        onChange={e => onEndKmChange(e.target.value)}
                        className="input"
                        placeholder="12400"
                        required
                    />
                </div>
            </div>
            {form.startKm && form.endKm && parseInt(form.endKm) >= parseInt(form.startKm) && (
                <div className="mt-3 text-center">
                    <span className="text-lg font-bold text-primary-600">
                        {(parseInt(form.endKm) - parseInt(form.startKm)).toLocaleString()} km
                    </span>
                    <span className="text-sm text-surface-400 ml-1">주행</span>
                </div>
            )}
        </div>
    );
}
