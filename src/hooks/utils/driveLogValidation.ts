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
    form: Partial<DriveLogForm> & Record<string, any>,
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
        const bs = form.batteryStart ? parseInt(form.batteryStart) : null;
        const be = form.batteryEnd ? parseInt(form.batteryEnd) : null;
        if ((bs !== null && (bs < 0 || bs > 100)) || (be !== null && (be < 0 || be > 100))) {
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
    if (driveDate && driveDate !== todayStr()) {
        const [y, m, d] = driveDate.split('-').map(Number);
        const timeStr = endTime || startTime || nowTime();
        const [h, min] = timeStr.split(':').map(Number);
        return new Date(y, m - 1, d, h, min);
    }
    return new Date();
}

interface BuildLogContext {
    orgId: string | null | undefined;
    user: { uid: string; displayName?: string | null; email?: string | null };
    userData: { name?: string } | null | undefined;
    selectedVehicle: { vehicleType?: string } | undefined;
    selectedPassengers: Array<{ name?: string; email?: string }>;
    externalPassengerCount?: number;
    isRetroactive: boolean;
}

/**
 * 폼 데이터로 저장용 logData 객체를 구성한다.
 */
export function buildLogData(form: DriveLogForm, { orgId, user, userData, selectedVehicle, selectedPassengers, externalPassengerCount = 0, isRetroactive }: BuildLogContext) {
    const startKm = parseInt(form.startKm);
    const endKm = parseInt(form.endKm);
    const driveTimestamp = buildDriveTimestamp(form.driveDate, form.endTime, form.startTime);

    return {
        organizationId: orgId,
        vehicleId: form.vehicleId,
        vehicleName: form.vehicleName,
        vehicleType: selectedVehicle?.vehicleType || '',
        driverUid: user.uid,
        driverName: userData?.name || user.displayName || user.email,
        purpose: form.purpose.trim(),
        destination: form.destination.trim(),
        startTime: form.startTime || '',
        endTime: form.endTime || nowTime(),
        startKm,
        endKm,
        distance: (startKm !== null && endKm !== null) ? endKm - startKm : null,
        fuelAmount: form.fuelAmount ? parseInt(form.fuelAmount) : null,
        batteryStart: form.batteryStart ? parseInt(form.batteryStart) : null,
        batteryEnd: form.batteryEnd ? parseInt(form.batteryEnd) : null,
        notes: form.notes.trim(),
        timestamp: driveTimestamp,
        passengerCount: selectedPassengers.length + externalPassengerCount + 1,
        passengerNames: selectedPassengers.map(p => p.name || p.email),
        externalPassengerCount,
        ...(isRetroactive && { isRetroactive: true }),
    };
}
