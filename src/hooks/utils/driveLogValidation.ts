/**
 * 운행일지 검증 유틸리티 — 순수 함수로 단위 테스트 가능
 */
import type { DriveLogForm } from '../useDriveLogForm';

/**
 * 현재 시간을 HH:MM 포맷으로 반환
 */
export const nowTime = () => {
    const n = new Date();
    return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
};

/**
 * 오늘 날짜를 YYYY-MM-DD 포맷으로 반환
 */
export const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * 운행일지 폼 데이터를 검증한다.
 */
export function validateDriveLogForm(
    form: Partial<DriveLogForm>,
    { isElectric = false, isQuickDrive = false } = {}
) {
    if (!form.vehicleId) {
        return { valid: false, message: '차량을 선택해주세요.' };
    }
    if (isQuickDrive && !form.startTime) {
        return { valid: false, message: '출발 시각을 입력해주세요.' };
    }
    if (!form.destination?.trim()) {
        return { valid: false, message: '목적지를 입력해주세요.' };
    }
    if (!form.startKm || !form.endKm) {
        return { valid: false, message: '출발 km와 도착 km를 입력해주세요.' };
    }

    const startKm = parseInt(form.startKm);
    const endKm = parseInt(form.endKm);

    if (isNaN(startKm) || isNaN(endKm)) {
        return { valid: false, message: 'km 값이 올바르지 않습니다.' };
    }
    if (startKm < 0 || endKm < 0) {
        return { valid: false, message: 'km 값은 0 이상이어야 합니다.' };
    }
    if (endKm < startKm) {
        return { valid: false, message: '도착 km가 출발 km보다 작습니다.' };
    }
    if (endKm - startKm > 10000) {
        return { valid: false, message: '한 번의 운행에 10,000km 이상은 입력할 수 없습니다. 값을 확인해주세요.' };
    }

    // 배터리 범위 검증 (전기차만)
    if (isElectric) {
        const bs = form.batteryStart ? parseInt(form.batteryStart) : undefined;
        const be = form.batteryEnd ? parseInt(form.batteryEnd) : undefined;
        if ((bs !== undefined && (bs < 0 || bs > 100)) || (be !== undefined && (be < 0 || be > 100))) {
            return { valid: false, message: '배터리 값은 0~100% 사이여야 합니다.' };
        }
    }

    return { valid: true, message: null };
}

interface BuildTimestampParams {
    driveDate: string;
    endTime: string;
    startTime: string;
}

/**
 * 운행 날짜 기반 timestamp를 생성한다.
 */
export function buildDriveTimestamp(driveDate: string, endTime: string, startTime: string) {
    const dateStr = driveDate || todayStr();
    const [y, m, d] = dateStr.split('-').map(Number);
    const timeStr = endTime || startTime || nowTime();
    const [h, min] = timeStr.split(':').map(Number);
    return new Date(y, m - 1, d, h, min);
}

interface BuildLogContext {
    orgId: string | null | undefined;
    user: { uid: string; displayName?: string | null; email?: string | null };
    userData: { name?: string } | null | undefined;
    selectedVehicle: { vehicleType?: string } | undefined;
    selectedPassengers: Array<{ name?: string; email?: string }>;
    externalPassengerCount?: number;
    isRetroactive: boolean;
    ocrUsed?: boolean;
    favoriteUsed?: boolean;
}

/**
 * 폼 데이터로 저장용 logData 객체를 구성한다.
 */
export function buildLogData(form: DriveLogForm, { orgId, user, userData, selectedVehicle, selectedPassengers, externalPassengerCount = 0, isRetroactive, ocrUsed = false, favoriteUsed = false }: BuildLogContext) {
    const startKm = parseInt(form.startKm);
    const endKm = parseInt(form.endKm);
    const driveTimestamp = buildDriveTimestamp(form.driveDate, form.endTime, form.startTime);

    return {
        organizationId: orgId ? String(orgId) : '',
        vehicleId: form.vehicleId,
        vehicleName: form.vehicleName,
        vehicleType: selectedVehicle?.vehicleType || '',
        driverUid: user.uid,
        driverName: userData?.name || user.displayName || user.email || '',
        purpose: form.purpose.trim(),
        destination: form.destination.trim(),
        startTime: form.startTime || '',
        endTime: form.endTime || nowTime(),
        startKm,
        endKm,
        distance: (!isNaN(startKm) && !isNaN(endKm)) ? endKm - startKm : undefined,
        batteryStart: form.batteryStart ? parseInt(form.batteryStart) : undefined,
        batteryEnd: form.batteryEnd ? parseInt(form.batteryEnd) : undefined,
        notes: form.notes.trim(),
        timestamp: driveTimestamp,
        passengerCount: selectedPassengers.length + externalPassengerCount + 1,
        passengerNames: selectedPassengers.map(p => p.name || p.email || ''),
        externalPassengerCount,
        inputMethod: ocrUsed ? 'ocr' as const : (favoriteUsed ? 'favorite' as const : 'manual' as const),
        ...(isRetroactive && { isRetroactive: true }),
    };
}

/**
 * Firestore Timestamp / Date / number / string → YYYY-MM-DD 변환
 * 파싱 실패 시 todayStr() 반환
 */
export function timestampToDateStr(ts: unknown): string {
    if (!ts) return todayStr();
    let d: Date;
    if (typeof ts === 'object' && ts !== null && 'toDate' in ts && typeof (ts as { toDate: () => Date }).toDate === 'function') {
        d = (ts as { toDate: () => Date }).toDate();
    } else if (typeof ts === 'object' && ts !== null && 'seconds' in ts) {
        d = new Date((ts as { seconds: number }).seconds * 1000);
    } else if (ts instanceof Date) {
        d = ts;
    } else {
        d = new Date(ts as string | number);
    }
    if (isNaN(d.getTime())) return todayStr();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

