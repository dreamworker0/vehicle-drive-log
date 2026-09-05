import { describe, it, expect } from 'vitest';
import { validateDriveWindow } from '@/hooks/driveLogForm/driveWindow';
import type { DriveLogForm } from '@/hooks/driveLogForm/types';

/**
 * 운행 구간 검증 — 원래 **아무 데도 없던** 검사다.
 *
 * 도착 시각이 출발보다 일러도 조용히 저장됐고, 그때 buildDriveTimestamp가 만드는
 * timestamp가 실제 운행보다 이른 시각을 가리켰다(정렬·집계·소급 판정이 그 값을 쓴다).
 * 이제 도착일이 있으므로 "오타"와 "다음 날 도착"을 가를 수 있다.
 */
function form(over: Partial<DriveLogForm> = {}): DriveLogForm {
    return {
        vehicleId: 'v1', vehicleName: '스타렉스',
        driverUid: 'u1', driverName: '홍길동',
        purpose: '업무', destination: '서울역',
        startKm: '1000', endKm: '1100',
        startTime: '09:00', endTime: '18:00',
        batteryStart: '', batteryEnd: '', notes: '',
        driveDate: '2026-09-01', endDate: '',
        needsRefuel: false, hipassBalanceAfter: '',
        ...over,
    } as DriveLogForm;
}

describe('validateDriveWindow', () => {
    it('같은 날 정상 운행은 통과시킨다', () => {
        expect(validateDriveWindow(form())).toBeNull();
    });

    it('같은 날인데 도착이 출발보다 이르면 막는다 — 오타다', () => {
        const msg = validateDriveWindow(form({ startTime: '17:00', endTime: '10:00' }));
        expect(msg).toContain('도착 시각');
        // 다음 날 도착이라면 어떻게 하는지 알려 준다
        expect(msg).toContain('도착일');
    });

    it('다음 날 도착이면 도착 시각이 일러도 통과시킨다 — 1박2일 운행', () => {
        expect(validateDriveWindow(form({
            driveDate: '2026-09-01', endDate: '2026-09-02',
            startTime: '17:00', endTime: '10:00',
        }))).toBeNull();
    });

    it('도착일이 출발일보다 빠르면 막는다', () => {
        expect(validateDriveWindow(form({
            driveDate: '2026-09-02', endDate: '2026-09-01',
        }))).toContain('도착일');
    });

    it('도착일이 비어 있으면 같은 날로 본다 — 기존 문서 전부가 이 경우다', () => {
        expect(validateDriveWindow(form({ endDate: '', startTime: '17:00', endTime: '10:00' })))
            .toContain('도착 시각');
    });

    it('시각이 비었거나 형식이 어긋나면 판단하지 않는다 — 입력 중일 수 있다', () => {
        expect(validateDriveWindow(form({ startTime: '', endTime: '' }))).toBeNull();
        expect(validateDriveWindow(form({ startTime: '9', endTime: '18:00' }))).toBeNull();
        expect(validateDriveWindow(form({ startTime: '25:00', endTime: '10:00' }))).toBeNull();
    });

    it('출발일이 비어 있으면 판단하지 않는다', () => {
        expect(validateDriveWindow(form({ driveDate: '' }))).toBeNull();
    });

    it('월·연 경계를 넘는 운행도 통과시킨다', () => {
        expect(validateDriveWindow(form({
            driveDate: '2026-12-31', endDate: '2027-01-01',
            startTime: '22:00', endTime: '08:00',
        }))).toBeNull();
    });
});
