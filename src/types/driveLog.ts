/**
 * 운행일지 (Drive Logs) 타입 정의
 */
import type { FirestoreDoc, TimestampField } from './common';

export interface DriveLog extends FirestoreDoc {
    [key: string]: unknown;
    organizationId: string;
    vehicleId: string;
    vehicleName?: string;
    vehicleDisplayName?: string;
    driverUid: string;
    driverName?: string;
    /** 일지 작성자 uid. 규칙 소유자 판정용(driverUid는 대표 운전자로 선택 가능해졌으므로 분리). 기존 문서 호환 위해 optional. */
    createdByUid?: string;
    /** 공동 운전자 이름 목록(정보성). 주행거리는 대표 운전자(driverUid)에게 귀속되며 배분하지 않음. */
    coDriverNames?: string[];
    /** 공동 운전자 중 조직원으로 매칭된 uid(편집 프리로드용). */
    coDriverUids?: string[];
    date?: string;
    timestamp: Date | TimestampField;
    startKm: number;
    endKm: number;
    distance?: number;
    startTime?: string;
    endTime?: string;
    purpose?: string;
    destination?: string;
    startLocation?: string;
    passengers?: number;
    vehicleType?: string;
    passengerCount?: number;
    passengerNames?: string[];
    notes?: string;
    fuelAmount?: number;
    energyCost?: number;
    hipassCardNumber?: string;
    hipassBalanceBefore?: number;
    hipassBalanceAfter?: number;
    batteryStart?: number;
    batteryEnd?: number;
    isRetroactive?: boolean;
    isIncomplete?: boolean;
    isManuallyCorrected?: boolean;
    originalStartKm?: number;
    reservationId?: string;
    inputMethod?: 'ocr' | 'manual' | 'favorite';
    createdAt?: TimestampField;
    editedAt?: TimestampField;
    /**
     * 마지막 수정자 uid — 접속기록의 '계정' 항목 (고시 제16조).
     *
     * Firestore 트리거는 호출자를 알 수 없어 수정 행위자가 공백이었다(Phase 123).
     * 클라이언트가 심는 값이지만 Rules가 `request.auth.uid`와의 일치를 강제하므로
     * **타인 명의로는 위조할 수 없다** — 콜러블 이관이나 오프라인 큐 변경 없이
     * 행위자를 확정할 수 있는 지점이 여기다.
     *
     * ⚠️ 삭제 행위자에는 쓸 수 없다. 삭제된 문서에 남은 값은 마지막 '수정자'이지
     * '삭제자'가 아니며, 이를 삭제자로 기록하면 무고한 사용자에게 책임이 귀속된다.
     */
    lastEditedByUid?: string;
    expiresAt?: Date | TimestampField;
}

/** createDriveLog에 전달할 데이터 */
export type CreateDriveLogData = Omit<DriveLog, 'id' | 'createdAt' | 'editedAt'>;

/**
 * 관리자 목록·테이블에서 다루는 운행일지 UI 뷰 타입.
 * Firestore 결과를 그대로 렌더에 쓰기 때문에 timestamp는 toDate()를 갖는 Firestore Timestamp 형태.
 * 정식 DriveLog는 timestamp가 Date | TimestampField 라서 별도 분리.
 */
export interface DriveLogEntry {
    id: string;
    vehicleId?: string;
    vehicleName?: string;
    driverUid?: string;
    driverName?: string;
    createdByUid?: string;
    coDriverNames?: string[];
    date?: string;
    startKm: number;
    endKm: number;
    startTime?: string;
    endTime?: string;
    destination?: string;
    purpose?: string;
    passengerCount?: number;
    timestamp?: { toDate: () => Date };
    [key: string]: unknown;
}

/** DriveLog 페이지네이션 결과 */
export interface DriveLogPage {
    docs: DriveLog[];
    lastDoc: unknown;  // Firestore DocumentSnapshot
    hasMore: boolean;
}

/** getDriveLogs 필터 옵션 */
export interface DriveLogFilters {
    limit?: number;
    startAfter?: unknown;  // Firestore DocumentSnapshot
}

/** 오프라인 동기화 큐페이로드 타입 검증 가드 (Create) */
export function isCreateDriveLogPayload(payload: unknown): payload is Record<string, unknown> {
    if (typeof payload !== 'object' || payload === null) return false;
    const p = payload as Record<string, unknown>;
    // 최소한의 필수 속성 타입 체크
    return typeof p.organizationId === 'string' 
        && typeof p.vehicleId === 'string'
        && typeof p.driverUid === 'string'
        && typeof p.startKm === 'number'
        && typeof p.endKm === 'number';
}

/** 오프라인 동기화 큐페이로드 타입 검증 가드 (Update) */
export function isUpdateDriveLogPayload(payload: unknown): payload is Record<string, unknown> & { id: string } {
    if (typeof payload !== 'object' || payload === null) return false;
    const p = payload as Record<string, unknown>;
    return typeof p.id === 'string';
}
