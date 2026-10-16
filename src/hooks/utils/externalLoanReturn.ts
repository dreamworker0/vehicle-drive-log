/**
 * externalLoanReturn — 외부 대여 반납을 운행일지 한 건으로 만든다 (순수 함수).
 *
 * 외부 대여는 이 앱을 쓰지 않는 기관에 차를 빌려준 기간이다(예약의 `externalLoan`). 빌려 간 쪽은
 * 운행일지를 쓸 수 없으므로 반납 때 관리자가 계기판을 받아 **대여 기간 전체를 한 건**으로 남긴다.
 *
 * 왜 운행일지인가
 *  - 계기판 km가 이어져야 한다. 대여 기간 주행거리가 빠지면 다음 직원의 출발 km가 직전 기록과 맞지 않아
 *    저장이 막히고(REQUIRES_START_KM_CONFIRMATION), 그 직원이 낮은 값을 받아들이면 대여 거리가 그 사람
 *    기록으로 들어간다.
 *  - 월간 보고·PDF·엑셀에 "언제 누구에게 나갔는가"가 남아야 대외 보고 자료가 된다(운전자 이름은 글자로 찍힌다).
 *
 * 형식은 운행일지 작성 화면(buildLogData)과 맞춘다 — 같은 서버 트리거(syncDriveLogKm)가 차량 km를 올린다.
 */
import { buildDriveTimestamp, todayStr } from './driveLogValidation';
import type { Reservation } from '../../types/reservation';

/** 한 번 운행 상한 — 운행일지 작성 화면(validateDriveLogForm)과 같은 값 */
export const MAX_LOAN_DISTANCE_KM = 10000;

export interface LoanPeriod {
    /** 운행일지가 가리킬 예약(그룹의 첫날) */
    first: Reservation;
    /** 대여 묶음 전체(취소된 날 제외, 날짜순) */
    days: Reservation[];
    startDate: string;
    startTime: string;
    plannedEndDate: string;
    plannedEndTime: string;
}

/** 대여 예약 하나에서 묶음 전체의 기간을 구한다. 여러 날이면 같은 groupId를 날짜순으로 모은다. */
export function resolveLoanPeriod(target: Reservation, all: Reservation[]): LoanPeriod {
    const days = target.groupId
        ? all.filter(r => r.groupId === target.groupId && r.status !== 'cancelled')
            .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
        : [target];
    const list = days.length > 0 ? days : [target];
    const first = list[0];
    const last = list[list.length - 1];
    return {
        first,
        days: list,
        startDate: first.date,
        startTime: first.startTime,
        plannedEndDate: last.date,
        plannedEndTime: last.endTime,
    };
}

export interface LoanReturnInput {
    orgId: string;
    adminUid: string;
    reservation: Reservation;
    period: LoanPeriod;
    vehicleType?: string;
    startKm: string;
    endKm: string;
    returnDate: string;
    returnTime: string;
    notes?: string;
    /** 테스트용 — 기본은 지금 */
    now?: Date;
}

export type LoanReturnResult =
    | { ok: true; id: string; data: Record<string, unknown>; returnDate: string }
    | { ok: false; error: string };

/** 반납 입력을 검사하고, 통과하면 운행일지 문서(id·데이터)를 돌려준다. */
export function buildExternalLoanDriveLog(input: LoanReturnInput): LoanReturnResult {
    const { orgId, adminUid, reservation, period, startKm: rawStart, endKm: rawEnd, returnDate, returnTime } = input;
    const loan = reservation.externalLoan;
    if (!loan) return { ok: false, error: '외부 대여 예약이 아닙니다.' };

    const startKm = Number(rawStart);
    const endKm = Number(rawEnd);
    if (rawStart === '' || rawEnd === '' || !Number.isInteger(startKm) || !Number.isInteger(endKm) || startKm < 0 || endKm < 0) {
        return { ok: false, error: '출발·도착 계기판 km를 0 이상의 정수로 입력해주세요.' };
    }
    if (endKm < startKm) return { ok: false, error: '도착 km는 출발 km보다 작을 수 없습니다.' };
    if (endKm - startKm > MAX_LOAN_DISTANCE_KM) {
        return { ok: false, error: `한 번 대여의 주행거리가 ${MAX_LOAN_DISTANCE_KM.toLocaleString()}km를 넘습니다. 계기판 값을 확인해주세요.` };
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(returnDate) || !/^\d{2}:\d{2}$/.test(returnTime)) {
        return { ok: false, error: '반납 날짜와 시각을 입력해주세요.' };
    }
    const departure = `${period.startDate} ${period.startTime}`;
    const arrival = `${returnDate} ${returnTime}`;
    if (arrival <= departure) return { ok: false, error: '반납 시각은 대여 시작 시각보다 늦어야 합니다.' };
    const now = input.now ?? new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const nowStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    if (arrival > nowStr) return { ok: false, error: '아직 오지 않은 시각으로는 반납할 수 없습니다.' };

    const isMultiDay = returnDate !== period.startDate;
    const today = input.now ? nowStr.slice(0, 10) : todayStr();
    const purpose = [`외부 대여(${loan.borrowerOrg})`, reservation.purpose?.trim()].filter(Boolean).join(' · ');

    const data: Record<string, unknown> = {
        organizationId: orgId,
        vehicleId: reservation.vehicleId,
        vehicleName: reservation.vehicleName || '',
        vehicleType: input.vehicleType || '',
        // 운전자는 기관 구성원이 아니다 — uid는 비우고 이름만 남긴다(보고서는 이름을 찍는다)
        driverUid: '',
        driverName: `(외부) ${loan.borrowerOrg} ${loan.driverName}`,
        createdByUid: adminUid,
        purpose,
        destination: (reservation.destination || '').trim(),
        startTime: period.startTime,
        endTime: returnTime,
        startKm,
        endKm,
        distance: endKm - startKm,
        notes: (input.notes || '').trim(),
        timestamp: buildDriveTimestamp(period.startDate, returnTime, period.startTime, returnDate),
        // 빌려 간 쪽의 탑승 인원은 알 수 없다 — 운전자 1명만 센다
        passengerCount: 1,
        passengerNames: [],
        inputMethod: 'manual',
        ...(isMultiDay ? { startDate: period.startDate } : {}),
        ...(returnDate < today ? { isRetroactive: true } : {}),
        reservationId: period.first.id,
        driveOrigin: 'external_loan',
        externalLoan: {
            borrowerOrg: loan.borrowerOrg,
            driverName: loan.driverName,
            ...(reservation.groupId ? { groupId: reservation.groupId } : {}),
        },
    };

    // 작성 화면과 같은 결정론적 ID(차량_작성자_출발일_출발km_도착km) — 두 번 눌러도 한 건이다
    const id = `${reservation.vehicleId}_${adminUid}_${period.startDate.replace(/-/g, '')}_${startKm}_${endKm}`;
    return { ok: true, id, data, returnDate };
}
