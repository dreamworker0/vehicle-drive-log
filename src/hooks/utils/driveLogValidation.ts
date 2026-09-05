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
    { isElectric = false } = {}
) {
    if (!form.vehicleId) {
        return { valid: false, message: '차량을 선택해주세요.' };
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
        return { valid: false, message: '도착 km는 출발 km보다 크거나 같아야 합니다.' };
    }
    if (endKm - startKm > 10000) {
        return { valid: false, message: '한 번의 운행에 10,000km 이상은 입력할 수 없습니다. 값을 확인해주세요.' };
    }

    // 하이패스 사용후 금액 검증.
    // 이 값은 저장 시 `increment(-(사용전 - 사용후))`로 카드 잔액에 반영되므로,
    // 음수가 들어오면 실제 사용액보다 큰 금액이 차감되어 카드 잔액까지 망가진다.
    if (form.hipassBalanceAfter) {
        const balanceAfter = Number(form.hipassBalanceAfter);
        if (!Number.isFinite(balanceAfter)) {
            return { valid: false, message: '하이패스 사용후 금액이 올바르지 않습니다.' };
        }
        if (balanceAfter < 0) {
            return { valid: false, message: '하이패스 사용후 금액은 0 이상이어야 합니다.' };
        }
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

/**
 * 운행 날짜 기반 timestamp를 생성한다.
 *
 * 기준은 **도착 시각**이다(바뀌지 않았다). 이틀 이상 걸린 운행이면 도착한 **날**이
 * `endDate`로 따로 들어오므로 그 날짜를 쓴다 — 그러지 않으면 9/1 17:00 출발 →
 * 9/2 10:00 도착이 `9/1 10:00`으로 찍혀, 출발보다 7시간 이른 시각이 그 일지의
 * 정렬 기준이 된다. `endDate`가 없는 기존 문서는 계산이 종전과 완전히 같다.
 */
export function buildDriveTimestamp(driveDate: string, endTime: string, startTime: string, endDate?: string) {
    const dateStr = endDate || driveDate || todayStr();
    const [y, m, d] = dateStr.split('-').map(Number);
    const timeStr = endTime || startTime || nowTime();
    const [h, min] = timeStr.split(':').map(Number);
    return new Date(y, m - 1, d, h, min);
}

interface BuildLogContext {
    orgId: string | null | undefined;
    user: { uid: string; displayName?: string | null; email?: string | null };
    userData: { name?: string } | null | undefined;
    selectedVehicle: { vehicleType?: string; siteVaries?: boolean } | undefined;
    selectedPassengers: Array<{ name?: string; email?: string }>;
    externalPassengerCount?: number;
    externalPassengerNames?: string;
    /** 공동 운전자로 선택된 조직원(정보성). */
    coDrivers?: Array<{ id?: string; name?: string; email?: string }>;
    /** 공동 운전자 직접 입력 이름(쉼표 구분). */
    externalCoDriverNames?: string;
    isRetroactive: boolean;
    ocrUsed?: boolean;
    favoriteUsed?: boolean;
    /**
     * 출발지 이름(분관을 등록한 기관만). 분관이 없으면 넘어오지 않으며, 그때는 필드를 만들지 않는다 —
     * 모든 기록에 "본관"이 붙어 봐야 읽는 사람에게 새 정보가 없다.
     */
    startLocation?: string;
}

/**
 * 폼 데이터로 저장용 logData 객체를 구성한다.
 */
export function buildLogData(form: DriveLogForm, { orgId, user, userData, selectedVehicle, selectedPassengers, externalPassengerCount = 0, externalPassengerNames = '', coDrivers = [], externalCoDriverNames = '', isRetroactive, ocrUsed = false, favoriteUsed = false, startLocation }: BuildLogContext) {
    const startKm = parseInt(form.startKm);
    const endKm = parseInt(form.endKm);
    const driveTimestamp = buildDriveTimestamp(form.driveDate, form.endTime, form.startTime, form.endDate);

    const parsedExternalNames = (externalPassengerNames || '')
        .split(',')
        .map(name => name.trim())
        .filter(Boolean);

    // 공동 운전자: 조직원 선택분 + 직접 입력분. 주행거리 배분 없이 이름만 기록(정보성).
    const parsedExternalCoDriverNames = (externalCoDriverNames || '')
        .split(',')
        .map(name => name.trim())
        .filter(Boolean);
    const coDriverNames = [
        ...coDrivers.map(c => c.name || c.email || '').filter(Boolean),
        ...parsedExternalCoDriverNames,
    ];
    const coDriverUids = coDrivers.map(c => c.id).filter((id): id is string => !!id);

    const cleanData: Record<string, unknown> = {
        organizationId: orgId ? String(orgId) : '',
        vehicleId: form.vehicleId,
        vehicleName: form.vehicleName,
        vehicleType: selectedVehicle?.vehicleType || '',
        // driverUid는 선택된 대표 운전자(기본값=작성자). createdByUid는 항상 작성자(규칙 소유자 판정용).
        driverUid: form.driverUid || user.uid,
        driverName: form.driverName || userData?.name || user.displayName || user.email || '',
        createdByUid: user.uid,
        // 공동 운전자는 값이 있을 때만 저장(빈 배열은 생략 → sanitizeUndefined 제거)
        coDriverNames: coDriverNames.length > 0 ? coDriverNames : undefined,
        coDriverUids: coDriverUids.length > 0 ? coDriverUids : undefined,
        purpose: (form.purpose || '').trim(),
        destination: (form.destination || '').trim(),
        startTime: form.startTime || '',
        endTime: form.endTime || nowTime(),
        startKm,
        endKm,
        notes: (form.notes || '').trim(),
        timestamp: driveTimestamp,
        passengerCount: selectedPassengers.length + externalPassengerCount + 1,
        passengerNames: [
            ...selectedPassengers.map(p => p.name || p.email || ''),
            ...parsedExternalNames
        ],
        externalPassengerCount,
        externalPassengerNames,
        inputMethod: ocrUsed ? 'ocr' : (favoriteUsed ? 'favorite' : 'manual'),
        // 분관을 등록한 기관에서만 값이 있다(그 외에는 undefined → sanitizeUndefined가 필드를 만들지 않는다)
        startLocation: startLocation || undefined,
        // 세운 곳은 출발지가 매번 바뀌는 차량에서만 남긴다. 차량을 유동 → 고정으로 바꾼 뒤
        // 폼에 남아 있던 값이 새어 나가면, 서버 트리거가 엉뚱한 차량의 위치를 옮긴다.
        endSiteId: selectedVehicle?.siteVaries ? (form.endSiteId || undefined) : undefined,
        // 표시했을 때만 필드를 남긴다(false는 undefined로 떨궈 sanitizeUndefined가 지운다).
        // 서버 트리거는 값의 존재만 보고 차량 상태를 켠다 — 끄는 것은 주유일지·관리자 몫이다.
        //
        // 오늘 것이 아닌 일지에는 아예 남기지 않는다. 입력칸을 켠 뒤 날짜를 과거로 바꾸면
        // UI는 사라지지만 폼 값은 true로 남는데, 그대로 저장하면 소급 문서에 표시가 묻는다.
        // 차량 상태는 서버 가드가 막지만 기록 자체가 사실과 달라진다(하이패스와 같은 경계).
        needsRefuel: (!isRetroactive && form.needsRefuel) || undefined,
        // 이틀 이상 걸린 운행에서만 **출발일**을 남긴다. 도착 쪽은 timestamp가 이미 담는다.
        // 같은 날이면 필드를 만들지 않아 기존 문서와 모양이 같아진다
        // (판정은 어디서나 `startDate ?? timestamp의 날짜`로 떨어진다).
        startDate: (form.endDate && form.endDate !== form.driveDate) ? form.driveDate : undefined,
    };

    if (!isNaN(startKm) && !isNaN(endKm)) {
        cleanData.distance = endKm - startKm;
    }

    if (form.batteryStart && !isNaN(parseInt(form.batteryStart))) {
        cleanData.batteryStart = parseInt(form.batteryStart);
    }

    if (form.batteryEnd && !isNaN(parseInt(form.batteryEnd))) {
        cleanData.batteryEnd = parseInt(form.batteryEnd);
    }

    if (isRetroactive) {
        cleanData.isRetroactive = true;
    }

    return cleanData;
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

