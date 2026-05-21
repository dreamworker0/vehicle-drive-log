/**
 * useDriveLogForm — 운행일지 작성/수정 폼의 상태 관리 및 서비스 통합 (Facade)
 * 리팩토링: 로직을 driveLogForm/ 하위 모듈로 분산하여 유지보수성 개선
 */
import { useState, useTransition } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from './useAuth';
import { useToast } from './useToast';
import useRetry from './useRetry';
import useDriveLogOcr from './useDriveLogOcr';
import { nowTime, todayStr, timestampToDateStr } from './utils/driveLogValidation';

import type { Vehicle } from '../types/vehicle';
import type { Favorite } from '../types/favorite';
import type { User as UserDoc } from '../types/user';
import type { HipassCard } from '../types/hipass';
import type { DriveLogForm, LocationState } from './driveLogForm/types';
import type { DriveLog } from '../types/driveLog';

// 타입 재수출 (하위 호환성 및 외부 참조용)
export type { DriveLogForm, LocationState };

// 하이 레벨에서 분리된 훅들 임포트
import { useDriveLogInitializer } from './driveLogForm/useDriveLogInitializer';
import { useDriveLogSubmit } from './driveLogForm/useDriveLogSubmit';

export default function useDriveLogForm() {
    const { user, userData } = useAuth();
    const location = useLocation();
    const { showToast } = useToast();
    const { runWithRetry } = useRetry();
    const [searchParams] = useSearchParams();
    const queryReservationId = searchParams.get('reservationId');

    const state = location.state as LocationState | null;
    const [resolvedReservationData, setResolvedReservationData] = useState<LocationState | null>(
        state?.reservationId ? state : null
    );
    const reservationData = resolvedReservationData;
    const editLog = state?.editLog || null;
    const isEditMode = !!editLog;
    /** @deprecated 바로 운행 기능은 사전 예약 체계로 대체됨 */
    const isQuickDrive = false;

    // ── 상태 정의 ──────────────────────────────────────────────────
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [favorites, setFavorites] = useState<Favorite[]>([]);
    const [members, setMembers] = useState<UserDoc[]>([]);
    const [loading, setLoading] = useState(true);
    const [isPending, startTransition] = useTransition();
    const [success, setSuccess] = useState(false);
    const [selectedPassengers, setSelectedPassengers] = useState<UserDoc[]>([]);
    const [externalPassengerCount, setExternalPassengerCount] = useState(0);
    const [externalPassengerNames, setExternalPassengerNames] = useState('');
    const [showFavSave, setShowFavSave] = useState(false);
    const [favName, setFavName] = useState('');
    const [hipassCard, setHipassCard] = useState<HipassCard | null>(null);
    const [lastEndBattery, setLastEndBattery] = useState<number | null>(null);
    const [lastDriveLog, setLastDriveLog] = useState<DriveLog | null>(null);
    const [nextDriveLog, setNextDriveLog] = useState<DriveLog | null>(null);

    const editDriveDate = editLog?.timestamp ? timestampToDateStr(editLog.timestamp) : todayStr();
    const [form, setForm] = useState<DriveLogForm>({
        vehicleId: editLog?.vehicleId || '',
        vehicleName: editLog?.vehicleName || '',
        purpose: editLog?.purpose || '',
        destination: editLog?.destination || '',
        startTime: editLog?.startTime as string || reservationData?.actualStartTime || nowTime(),
        endTime: editLog?.endTime as string || '',
        startKm: editLog?.startKm?.toString() || '',
        endKm: editLog?.endKm?.toString() || '',
        batteryStart: editLog?.batteryStart?.toString() || '',
        batteryEnd: editLog?.batteryEnd?.toString() || '',
        notes: editLog?.notes || '',
        driveDate: editDriveDate,
        hipassBalanceAfter: '',
    });

    const orgId = userData?.organizationId;
    const selectedVehicle = vehicles.find(v => v.id === form.vehicleId);
    const isElectric = selectedVehicle?.fuelType === 'electric';
    const isRetroactive = form.driveDate !== todayStr();

    // ── 하위 모듈 1: OCR (기존 훅 유지) ──────────────────────────
    const ocr = useDriveLogOcr({ 
        isElectric, 
        setForm, 
        user, 
        userData, 
        vehicleName: form.vehicleName 
    });

    // ── 하위 모듈 2: 초기화 (Side Effects) ─────────────────────
    useDriveLogInitializer({
        orgId, user, isEditMode, editLog, reservationData,
        queryReservationId, resolvedReservationData, isElectric,
        form, showToast,
        setVehicles, setFavorites, setMembers, setLoading,
        setForm, setSelectedPassengers, setExternalPassengerCount,
        setResolvedReservationData, setLastEndBattery, setHipassCard,
        setLastDriveLog,
        setNextDriveLog,
        vehicles
    });

    // ── 하위 모듈 3: 핸들러 및 제출 ───────────────────────────
    const {
        confirmStartKm,
        kmRangeError,
        handleDismissKmRangeError,
        handleConfirmStartKm,
        handleCancelConfirm,
        handleVehicleSelect,
        handleFavoriteSelect,
        handleSaveFavorite,
        togglePassenger,
        handleSubmit
    } = useDriveLogSubmit({
        form, setForm, orgId, user, userData, vehicles, selectedVehicle,
        selectedPassengers, setSelectedPassengers, externalPassengerCount, setExternalPassengerCount,
        externalPassengerNames,
        setFavorites, setShowFavSave, setFavName, setSuccess,
        isElectric, isQuickDrive, isRetroactive, isEditMode, editLog, reservationData, hipassCard, favName,
        showToast, runWithRetry, startTransition, ocrSuccess: ocr.ocrSuccess,
        lastDriveLog, nextDriveLog, setLastDriveLog
    });

    // ── 공개 API ──────────────────────────────────────────────────
    return {
        form, setForm,
        vehicles, favorites, members,
        loading, submitting: isPending, success,
        selectedPassengers, selectedVehicle,
        isElectric,
        reservationData, isQuickDrive,
        editLog, isEditMode, isRetroactive,
        showFavSave, setShowFavSave,
        favName, setFavName,
        hipassCard,
        lastEndBattery,
        lastDriveLog,
        nextDriveLog,
        ocrLoading: ocr.ocrLoading,
        ocrError: ocr.ocrError,
        ocrSuccess: ocr.ocrSuccess,
        ocrImageUrl: ocr.ocrImageUrl,
        ocrReportSending: ocr.ocrReportSending,
        ocrReportSent: ocr.ocrReportSent,
        cameraInputRef: ocr.cameraInputRef,
        endKmInputRef: ocr.endKmInputRef,
        handleVehicleSelect,
        handleFavoriteSelect,
        handleSaveFavorite,
        togglePassenger,
        externalPassengerCount, setExternalPassengerCount,
        externalPassengerNames, setExternalPassengerNames,
        handleOcrCapture: ocr.handleOcrCapture,
        handleOcrReport: ocr.handleOcrReport,
        handleSubmit,
        confirmStartKm,
        kmRangeError,
        handleDismissKmRangeError,
        handleConfirmStartKm,
        handleCancelConfirm,
    };
}
