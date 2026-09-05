/**
 * driveLogForm/types.ts
 * useDriveLogForm 관련 공유 타입 정의
 */
import type { DriveLog } from '../../types/driveLog';

export interface DriveLogForm {
    vehicleId: string;
    vehicleName: string;
    /** 대표 운전자 uid. 기본값은 작성자 본인이며, 조직원 중에서 선택 가능. */
    driverUid: string;
    /** 대표 운전자 표시 이름. */
    driverName: string;
    purpose: string;
    destination: string;
    startTime: string;
    endTime: string;
    startKm: string;
    endKm: string;
    batteryStart: string;
    batteryEnd: string;
    notes: string;
    /** 출발일. 도착일(endDate)이 비어 있으면 이 날 안에 끝난 운행이다. */
    driveDate: string;
    /** 도착일. 출발일과 같거나 비어 있으면 당일 운행으로 본다. */
    endDate: string;
    hipassBalanceAfter: string;
    /**
     * 운전자가 "주유(충전) 필요"로 표시했는가.
     * 기관이 기능을 켠 경우에만 입력칸이 뜨므로, 꺼진 기관에서는 늘 false다.
     */
    needsRefuel: boolean;
    /**
     * 출발지·세운 곳으로 고른 출발지 id (`organization.sites[].id`, 본관은 `main`).
     *
     * 출발지가 매번 바뀌는 차량에서만 채워진다. 고정 출발지 차량에서는 값이 아예 없고,
     * 그때 출발지 라벨은 예전처럼 차량의 기본 차고지에서 파생된다 — optional인 이유다.
     */
    startSiteId?: string;
    endSiteId?: string;
}

export interface LocationState {
    reservationId?: string;
    vehicleId?: string;
    vehicleName?: string;
    purpose?: string;
    destination?: string;
    actualStartTime?: string;
    currentKm?: number;
    editLog?: DriveLog & { passengerNames?: string[] };
    /** 예약에 미리 적어 둔 동승자(예정) — 운행일지 폼의 초기값이 된다 */
    passengerUids?: string[];
    passengerNames?: string[];
    passengerCount?: number;
    /** 예약 없이 과거 누락 건을 직접 소급 입력하는 진입점 여부 */
    retroactive?: boolean;
}
