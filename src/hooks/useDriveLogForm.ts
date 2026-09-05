/**
 * useDriveLogForm — 운행일지 작성/수정 폼의 상태 관리 및 서비스 통합 (Facade)
 * 리팩토링: 로직을 driveLogForm/ 하위 모듈로 분산하여 유지보수성 개선
 */
import { useState, useTransition, useMemo, useEffect, useRef } from 'react';
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
import { canChooseSite, resolveStartLocationLabel, resolveVehicleCurrentSite, resolveVehicleSite } from '../lib/orgSites';
import { useDriveLogInitializer } from './driveLogForm/useDriveLogInitializer';
import { useDriveLogSubmit } from './driveLogForm/useDriveLogSubmit';

export default function useDriveLogForm() {
    const { user, userData, orgSites } = useAuth();
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
    // 예약 없이 과거 누락 건을 직접 소급 입력하는 진입점(내 기록 → "누락 운행 입력").
    // 이 모드에서만 신규 작성 폼에 운행 일자 섹션을 노출해 과거 날짜 선택을 허용한다.
    const retroEntry = !!state?.retroactive && !isEditMode;

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
    const [selectedCoDrivers, setSelectedCoDrivers] = useState<UserDoc[]>([]);
    const [externalCoDriverNames, setExternalCoDriverNames] = useState('');
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
        // 대표 운전자: 편집 시 기존 값, 신규 시 작성자 본인
        driverUid: editLog?.driverUid || user?.uid || '',
        driverName: editLog?.driverName || userData?.name || user?.displayName || user?.email || '',
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
        needsRefuel: false,
    });

    const orgId = userData?.organizationId;
    const selectedVehicle = vehicles.find(v => v.id === form.vehicleId);
    const isElectric = selectedVehicle?.fuelType === 'electric';
    const isRetroactive = form.driveDate !== todayStr();

    /**
     * 출발지·세운 곳의 기본값을 차량마다 **한 번만** 채운다.
     *
     * 매 렌더 채우면 운전자가 고른 값이 조용히 되돌아간다(orgSites·vehicles는 배열 정체성이
     * 바뀔 수 있어 의존성만으로는 막지 못한다). 그래서 초기화를 끝낸 차량 id를 기억해 둔다.
     */
    const siteDefaultsAppliedRef = useRef<string | null>(null);
    useEffect(() => {
        const vehicleId = form.vehicleId;
        if (!vehicleId) return;

        // 차량 목록이 아직 안 왔으면 아무 판단도 하지 않는다. 수정 모드는 editLog에서 vehicleId를
        // **동기적으로** 채우는데 vehicles는 비동기라, 여기서 판정하면 "고정 차량"으로 오인해
        // 초기화를 끝냈다고 표시해 버린다. 그러면 차량이 도착한 뒤에도 복원이 영영 실행되지 않고,
        // 저장 시 startLocation이 '본관'으로 덮여 **기록의 출발지가 조용히 바뀐다**.
        if (!selectedVehicle) return;

        // 고정 출발지 차량으로 바꾸면 남아 있던 선택을 비운다 — 그대로 두면 저장 시점에
        // 고정 차량의 기록으로 새어 나간다.
        if (!canChooseSite(orgSites, selectedVehicle)) {
            siteDefaultsAppliedRef.current = vehicleId;
            setForm(prev => (prev.startSiteId || prev.endSiteId)
                ? { ...prev, startSiteId: undefined, endSiteId: undefined }
                : prev);
            return;
        }

        if (siteDefaultsAppliedRef.current === vehicleId) return;
        siteDefaultsAppliedRef.current = vehicleId;

        // 수정 모드에서는 기록에 남은 값을 복원한다. 차량의 현재 위치로 덮으면 과거 기록이
        // 오늘 상태로 오염된다. 출발지는 라벨만 저장돼 있어 이름으로 되찾고, 못 찾으면
        // 현재 위치로 떨어진다 — 폼 초기값이라 틀려도 운전자 눈에 보이고 고칠 수 있다.
        const restoredStart = isEditMode && editLog?.startLocation
            ? orgSites.find(site => site.name === editLog.startLocation)?.id
            : undefined;
        const restoredEnd = isEditMode ? editLog?.endSiteId : undefined;
        const currentSiteId = resolveVehicleCurrentSite(orgSites, selectedVehicle).id;

        setForm(prev => ({
            ...prev,
            startSiteId: restoredStart ?? currentSiteId,
            endSiteId: restoredEnd ?? restoredStart ?? currentSiteId,
        }));
    }, [form.vehicleId, orgSites, selectedVehicle, isEditMode, editLog]);

    // ── 운전자 지정 관련 파생값 ──────────────────────────────────
    const isAdmin = userData?.role === 'admin';
    // 편집 대상 일지의 작성자 여부(구 데이터는 createdByUid가 없어 driverUid로 폴백)
    const isOwner = !!user && !!editLog && (
        editLog.createdByUid === user.uid ||
        (!editLog.createdByUid && editLog.driverUid === user.uid)
    );
    // 대표 운전자 변경 허용: 신규 작성이거나, 관리자거나, 본인 일지 편집일 때
    const canEditDriver = !isEditMode || isAdmin || isOwner;
    // 대표 운전자 후보 = 본인 + 조직원(members는 initializer에서 본인 제외됨)
    const selfUserDoc = useMemo<UserDoc | null>(() => {
        if (!user) return null;
        return {
            id: user.uid,
            uid: user.uid,
            name: userData?.name || user.displayName || user.email || '나',
            email: userData?.email || user.email || '',
            role: userData?.role || 'employee',
            organizationId: userData?.organizationId ?? null,
        } as UserDoc;
    }, [user, userData]);
    // 지정 차량(allowedUserIds)일 때는 그 차량을 탈 수 있는 조직원만 운전자 후보로 노출.
    // 동승자는 운전이 아니므로 제한하지 않는다(members 원본 유지).
    const driverEligibleMembers = useMemo<UserDoc[]>(() => {
        const allowed = selectedVehicle?.allowedUserIds;
        if (!allowed || allowed.length === 0) return members;
        return members.filter(m => allowed.includes(m.id));
    }, [members, selectedVehicle]);
    const driverCandidates = useMemo<UserDoc[]>(
        () => (selfUserDoc ? [selfUserDoc, ...driverEligibleMembers] : driverEligibleMembers),
        [selfUserDoc, driverEligibleMembers]
    );

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
        setForm, setSelectedPassengers, setExternalPassengerCount, setExternalPassengerNames,
        setSelectedCoDrivers, setExternalCoDriverNames,
        setResolvedReservationData, setLastEndBattery, setHipassCard,
        setLastDriveLog,
        setNextDriveLog,
        vehicles, members
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
        toggleCoDriver,
        handleSelectDriver,
        handleSubmit
    } = useDriveLogSubmit({
        form, setForm, orgId, user, userData, vehicles, selectedVehicle,
        selectedPassengers, setSelectedPassengers, externalPassengerCount, setExternalPassengerCount,
        externalPassengerNames,
        selectedCoDrivers, setSelectedCoDrivers, externalCoDriverNames, setExternalCoDriverNames,
        setFavorites, setShowFavSave, setFavName, setSuccess,
        isElectric, isRetroactive, isEditMode, editLog, reservationData, hipassCard, favName,
        showToast, runWithRetry, startTransition, ocrSuccess: ocr.ocrSuccess,
        lastDriveLog, nextDriveLog, setLastDriveLog,
        // 출발지가 매번 바뀌는 차량은 운전자가 폼에서 고른 값을 기록한다.
        // 고정 출발지 차량은 예전 그대로 차량의 기본 차고지에서 라벨을 파생시킨다.
        startLocation: canChooseSite(orgSites, selectedVehicle)
            ? resolveVehicleSite(orgSites, { siteId: form.startSiteId }).name
            : resolveStartLocationLabel(orgSites, selectedVehicle),
    });

    // ── 공개 API ──────────────────────────────────────────────────
    return {
        form, setForm,
        vehicles, favorites, members,
        loading, submitting: isPending, success,
        selectedPassengers, selectedVehicle,
        selectedCoDrivers,
        externalCoDriverNames, setExternalCoDriverNames,
        toggleCoDriver,
        handleSelectDriver,
        driverCandidates,
        driverEligibleMembers,
        isAdmin, canEditDriver,
        isElectric,
        reservationData,
        editLog, isEditMode, isRetroactive, retroEntry,
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
