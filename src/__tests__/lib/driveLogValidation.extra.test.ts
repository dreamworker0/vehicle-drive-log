/**
 * driveLogValidation 추가 테스트 — buildDriveTimestamp, buildLogData
 */
import { describe, it, expect } from 'vitest';
import { buildDriveTimestamp, buildLogData, todayStr } from '../../hooks/utils/driveLogValidation';

describe('buildDriveTimestamp', () => {
    it('소급 입력 시 지정 날짜+endTime 조합으로 Date를 생성해야 한다', () => {
        const result = buildDriveTimestamp('2026-01-15', '14:30', '09:00');
        expect(result.getFullYear()).toBe(2026);
        expect(result.getMonth()).toBe(0); // 1월 = 0
        expect(result.getDate()).toBe(15);
        expect(result.getHours()).toBe(14);
        expect(result.getMinutes()).toBe(30);
    });

    it('소급 입력 시 endTime이 없으면 startTime을 사용해야 한다', () => {
        const result = buildDriveTimestamp('2026-02-20', '', '10:15');
        expect(result.getHours()).toBe(10);
        expect(result.getMinutes()).toBe(15);
    });

    it('당일 입력 시 입력된 시간 기반 Date를 반환해야 한다', () => {
        const today = todayStr();
        const result = buildDriveTimestamp(today, '18:00', '09:00');
        // 당일이라도 endTime(18:00) 기반으로 생성
        expect(result.getHours()).toBe(18);
        expect(result.getMinutes()).toBe(0);
    });

    it('driveDate가 빈 문자열이면 오늘 날짜 + 입력 시간으로 반환해야 한다', () => {
        const result = buildDriveTimestamp('', '18:00', '09:00');
        const now = new Date();
        expect(result.getDate()).toBe(now.getDate());
        expect(result.getHours()).toBe(18);
        expect(result.getMinutes()).toBe(0);
    });
});

describe('buildLogData', () => {
    const baseMockForm = {
        vehicleId: 'v1',
        vehicleName: '소나타',
        driverUid: '',
        driverName: '',
        purpose: '  가정방문  ',
        destination: '  김OO 어르신 댁  ',
        startTime: '09:00',
        endTime: '10:30',
        startKm: '1000',
        endKm: '1050',

        batteryStart: '',
        batteryEnd: '',
        notes: '  특이사항 없음  ',
        driveDate: '',
        hipassBalanceAfter: '',
    };

    const baseContext = {
        orgId: 'org1',
        user: { uid: 'u1', displayName: '홍길동', email: 'hong@test.com' },
        userData: { name: '홍길동' },
        selectedVehicle: { vehicleType: 'sedan' },
        selectedPassengers: [{ name: '김직원' }, { name: '이직원' }],
        isRetroactive: false,
    };

    it('필수 필드들을 정확히 반환해야 한다', () => {
        const result = buildLogData(baseMockForm, baseContext);

        expect(result.organizationId).toBe('org1');
        expect(result.vehicleId).toBe('v1');
        expect(result.vehicleName).toBe('소나타');
        expect(result.driverUid).toBe('u1');
        expect(result.driverName).toBe('홍길동');
        expect(result.purpose).toBe('가정방문'); // trim 적용
        expect(result.destination).toBe('김OO 어르신 댁'); // trim 적용
        expect(result.startKm).toBe(1000);
        expect(result.endKm).toBe(1050);
        expect(result.distance).toBe(50);
    });

    it('탑승인원은 동승자 수 + 1(운전자)이어야 한다', () => {
        const result = buildLogData(baseMockForm, baseContext);
        expect(result.passengerCount).toBe(3); // 2명 동승자 + 운전자
        expect(result.passengerNames).toEqual(['김직원', '이직원']);
    });

    it('소급 입력(isRetroactive=true) 시 isRetroactive 필드가 포함되어야 한다', () => {
        const result = buildLogData(baseMockForm, { ...baseContext, isRetroactive: true });
        expect(result.isRetroactive).toBe(true);
    });

    it('소급 입력이 아니면 isRetroactive 필드가 없어야 한다', () => {
        const result = buildLogData(baseMockForm, baseContext);
        expect(result).not.toHaveProperty('isRetroactive');
    });



    it('배터리 값이 빈 문자열이면 undefined이어야 한다', () => {
        const result = buildLogData(baseMockForm, baseContext);
        expect(result.batteryStart).toBeUndefined();
        expect(result.batteryEnd).toBeUndefined();
    });

    it('전기차 배터리 값이 있으면 정수로 변환해야 한다', () => {
        const evForm = { ...baseMockForm, batteryStart: '85', batteryEnd: '40' };
        const result = buildLogData(evForm, baseContext);
        expect(result.batteryStart).toBe(85);
        expect(result.batteryEnd).toBe(40);
    });

    it('notes는 trim 되어야 한다', () => {
        const result = buildLogData(baseMockForm, baseContext);
        expect(result.notes).toBe('특이사항 없음');
    });

    it('userData.name이 없으면 displayName을 사용해야 한다', () => {
        const result = buildLogData(baseMockForm, {
            ...baseContext,
            userData: { name: '' },
        });
        expect(result.driverName).toBe('홍길동');
    });
});
