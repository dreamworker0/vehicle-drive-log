/**
 * driveLogValidation 단위 테스트
 * 실제 유틸리티 모듈(hooks/utils/driveLogValidation)에서 import하여 검증
 */
import { describe, it, expect } from 'vitest';
import { validateDriveLogForm, buildDriveTimestamp, buildLogData } from '../../hooks/utils/driveLogValidation';

describe('운행일지 폼 유효성 검증', () => {
    const validForm = {
        vehicleId: 'v1',
        destination: '서울역',
        startKm: '1000',
        endKm: '1050',
    };

    it('정상 입력은 valid: true를 반환한다', () => {
        const result = validateDriveLogForm(validForm);
        expect(result.valid).toBe(true);
        expect(result.message).toBeNull();
    });

    it('차량 미선택 시 에러를 반환한다', () => {
        const result = validateDriveLogForm({ ...validForm, vehicleId: '' });
        expect(result.valid).toBe(false);
        expect(result.message).toBe('차량을 선택해주세요.');
    });

    it('목적지 빈값 시 에러를 반환한다', () => {
        const result = validateDriveLogForm({ ...validForm, destination: '  ' });
        expect(result.valid).toBe(false);
        expect(result.message).toBe('목적지를 입력해주세요.');
    });

    it('Km 빈값 시 에러를 반환한다', () => {
        const result = validateDriveLogForm({ ...validForm, startKm: '' });
        expect(result.valid).toBe(false);
        expect(result.message).toBe('출발 km와 도착 km를 입력해주세요.');
    });

    it('Km 숫자가 아닌 값 입력 시 에러를 반환한다', () => {
        const result = validateDriveLogForm({ ...validForm, startKm: 'abc' });
        expect(result.valid).toBe(false);
        expect(result.message).toBe('km 값이 올바르지 않습니다.');
    });

    it('Km 음수값 입력 시 에러를 반환한다', () => {
        const result = validateDriveLogForm({ ...validForm, startKm: '-100', endKm: '100' });
        expect(result.valid).toBe(false);
        expect(result.message).toBe('km 값은 0 이상이어야 합니다.');
    });

    it('도착Km가 출발Km보다 작으면 에러를 반환한다', () => {
        const result = validateDriveLogForm({ ...validForm, startKm: '1050', endKm: '1000' });
        expect(result.valid).toBe(false);
        expect(result.message).toBe('도착 km가 출발 km보다 작습니다.');
    });

    it('한 번에 10,000km 이상 운행 시 에러를 반환한다', () => {
        const result = validateDriveLogForm({ ...validForm, startKm: '1000', endKm: '12000' });
        expect(result.valid).toBe(false);
        expect(result.message).toContain('10,000km');
    });

    describe('전기차 배터리 검증', () => {
        it('배터리가 0~100% 범위이면 통과한다', () => {
            const result = validateDriveLogForm(
                { ...validForm, batteryStart: '80', batteryEnd: '50' },
                { isElectric: true }
            );
            expect(result.valid).toBe(true);
        });

        it('배터리가 100% 초과하면 에러를 반환한다', () => {
            const result = validateDriveLogForm(
                { ...validForm, batteryStart: '120' },
                { isElectric: true }
            );
            expect(result.valid).toBe(false);
            expect(result.message).toBe('배터리 값은 0~100% 사이여야 합니다.');
        });

        it('배터리가 음수이면 에러를 반환한다', () => {
            const result = validateDriveLogForm(
                { ...validForm, batteryEnd: '-5' },
                { isElectric: true }
            );
            expect(result.valid).toBe(false);
            expect(result.message).toBe('배터리 값은 0~100% 사이여야 합니다.');
        });
    });
});

describe('buildDriveTimestamp', () => {
    it('소급 입력 시 선택 날짜 기준 타임스탬프를 생성한다', () => {
        const ts = buildDriveTimestamp('2026-01-15', '17:30', '09:00');
        expect(ts.getFullYear()).toBe(2026);
        expect(ts.getMonth()).toBe(0); // 0-indexed → 1월
        expect(ts.getDate()).toBe(15);
        expect(ts.getHours()).toBe(17);
        expect(ts.getMinutes()).toBe(30);
    });

    it('오늘 날짜면 입력된 시간 기준 타임스탬프를 생성한다', () => {
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const ts = buildDriveTimestamp(todayStr, '17:30', '09:00');
        // 오늘이라도 endTime(17:30) 기반으로 생성
        expect(ts.getHours()).toBe(17);
        expect(ts.getMinutes()).toBe(30);
        expect(ts.getDate()).toBe(now.getDate());
    });
});

describe('buildLogData', () => {
    it('폼 데이터를 로그 객체로 변환한다', () => {
        const form = {
            vehicleId: 'v1', vehicleName: '체어맨',
            purpose: '출장', destination: '서울역',
            startKm: '1000', endKm: '1050',
            startTime: '09:00', endTime: '17:30',
            batteryStart: '', batteryEnd: '',
            notes: '비고 없음', driveDate: '2026-01-15',
            hipassBalanceAfter: '',
        };
        const context = {
            orgId: 'org1',
            user: { uid: 'u1', displayName: '홍길동', email: 'hong@test.com' },
            userData: { name: '홍길동' },
            selectedVehicle: { vehicleType: 'sedan' },
            selectedPassengers: [{ name: '김철수' }],
            isRetroactive: true,
        };

        const result = buildLogData(form, context);
        expect(result.organizationId).toBe('org1');
        expect(result.vehicleId).toBe('v1');
        expect(result.startKm).toBe(1000);
        expect(result.endKm).toBe(1050);
        expect(result.distance).toBe(50);

        expect(result.passengerCount).toBe(2); // 기사 + 동승자 1명
        expect(result.passengerNames).toEqual(['김철수']);
        expect(result.isRetroactive).toBe(true);
    });
});
