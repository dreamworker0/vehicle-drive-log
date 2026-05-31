import { describe, it, expect } from 'vitest';
import { 
    userSchema, 
    vehicleSchema, 
    driveLogSchema, 
    organizationSchema, 
    reservationSchema 
} from '../../schemas/index';

describe('핵심 엔티티 Zod 스키마 검증', () => {
    
    describe('userSchema', () => {
        it('올바른 사용자 데이터를 파싱하면 그대로 데이터를 성공적으로 보존한다', () => {
            const validUser = {
                id: 'user-001',
                uid: 'uid-abc',
                name: '장보고',
                email: 'jang@ocean.com',
                role: 'admin',
                organizationId: 'org-123',
                status: 'active',
                theme: 'dark',
            };
            
            const result = userSchema.safeParse(validUser);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.name).toBe('장보고');
                expect(result.data.role).toBe('admin');
            }
        });

        it('중요 필드가 누락되거나 자료형이 맞지 않는 경우 catch() 기능이 안전한 기본값으로 자동 교정한다', () => {
            const invalidUser = {
                id: 12345, // string에 number 주입 -> catch('')
                name: 12345, // string에 number 주입 -> catch('-')
                email: 12345, // string에 number 주입 -> catch('')
                role: 'super_ultra_admin', // enum에 없는 권한 주입 -> catch('employee')
                organizationId: {}, // string에 object 주입 -> catch(null)
                status: 'invalid-status', // enum에 없는 상태 주입 -> catch('active')
            };

            const result = userSchema.safeParse(invalidUser);
            expect(result.success).toBe(true); // catch()가 모든 타입 에러를 가로채 기본값으로 복구하므로 success는 true임
            if (result.success) {
                expect(result.data.id).toBe(''); // id 에러 -> 기본값 ''
                expect(result.data.name).toBe('-'); // name 에러 -> 기본값 '-'
                expect(result.data.email).toBe(''); // email 에러 -> 기본값 ''
                expect(result.data.role).toBe('employee'); // 잘못된 role -> 기본값 'employee'
                expect(result.data.organizationId).toBeNull(); // 잘못된 orgId -> 기본값 null
                expect(result.data.status).toBe('active'); // 잘못된 status -> 기본값 'active'
            }
        });
    });

    describe('vehicleSchema', () => {
        it('올바른 차량 데이터를 정상 파싱한다', () => {
            const validVehicle = {
                organizationId: 'org-123',
                modelName: '쏘나타',
                plateNumber: '12가 3456',
                currentKm: 5000,
            };

            const result = vehicleSchema.safeParse(validVehicle);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.modelName).toBe('쏘나타');
                expect(result.data.plateNumber).toBe('12가 3456');
                expect(result.data.currentKm).toBe(5000);
            }
        });

        it('차량 번호, 기관 ID 등이 올바르지 않은 경우 catch()가 기본값으로 대체하고 누적 Km 에러 시 0으로 복원한다', () => {
            const corruptVehicle = {
                modelName: '그랜저', // 필수 필드 modelName은 정상 타입 제공
                organizationId: 99999, // string에 number 주입 -> catch('')
                plateNumber: 12345, // string에 number 주입 -> catch('번호 없음')
                currentKm: '이만키로', // coercion number에 invalid string -> catch(0)
            };
            const result = vehicleSchema.safeParse(corruptVehicle);
            
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.modelName).toBe('그랜저');
                expect(result.data.organizationId).toBe('');
                expect(result.data.plateNumber).toBe('번호 없음');
                expect(result.data.currentKm).toBe(0);
            }
        });
    });

    describe('driveLogSchema', () => {
        it('올바른 운행일지 데이터를 정상 파싱한다', () => {
            const validDrive = {
                organizationId: 'org-123',
                vehicleId: 'veh-777',
                driverUid: 'user-01',
                startKm: 10000,
                endKm: 10050,
                distance: 50,
            };

            const result = driveLogSchema.safeParse(validDrive);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.startKm).toBe(10000);
                expect(result.data.distance).toBe(50);
            }
        });

        it('운행 거리나 누적 Km 정보가 비정상적 형식이면 각각 기본값으로 복원한다', () => {
            const corruptDrive = {
                organizationId: 123, // string에 number -> catch('')
                vehicleId: {}, // string에 object -> catch('')
                driverUid: 999, // string에 number -> catch('')
                startKm: '만키로', // coerce number에 invalid -> catch(0)
                endKm: undefined, // endKm 누락 시 (optional()이 아니므로) catch(0) 작동
                distance: '오십', // number에 invalid string -> catch(undefined)
            };

            const result = driveLogSchema.safeParse(corruptDrive);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.organizationId).toBe('');
                expect(result.data.vehicleId).toBe('');
                expect(result.data.driverUid).toBe('');
                expect(result.data.startKm).toBe(0);
                expect(result.data.endKm).toBe(0);
                expect(result.data.distance).toBeUndefined(); // 에러 발생 시 catch(undefined)에 의해 undefined 처리
            }
        });
    });

    describe('organizationSchema', () => {
        it('올바른 기관 정보를 정상 파싱한다', () => {
            const validOrg = {
                id: 'org-abc',
                name: '푸른돌 복지관',
                applicantUid: 'uid-applicant',
                status: 'approved',
            };

            const result = organizationSchema.safeParse(validOrg);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.name).toBe('푸른돌 복지관');
                expect(result.data.status).toBe('approved');
            }
        });

        it('기관명 유실 시 빈 문자열, 승인 상태 불일치 시 pending 상태로 자동 복원한다', () => {
            const corruptOrg = {
                name: 12345, // string에 number -> catch('')
                applicantUid: 999, // string에 number -> catch('')
                status: 'invalid-status', // enum 범위를 벗어난 문자열 -> catch('pending')
            };
            const result = organizationSchema.safeParse(corruptOrg);
            
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.name).toBe('');
                expect(result.data.applicantUid).toBe('');
                expect(result.data.status).toBe('pending');
            }
        });
    });

    describe('reservationSchema', () => {
        it('올바른 예약 정보 데이터를 정상 파싱한다', () => {
            const validRes = {
                organizationId: 'org-123',
                vehicleId: 'veh-777',
                reservedByUid: 'user-01',
                date: '2026-05-05',
                startTime: '09:00',
                endTime: '12:00',
                purpose: '외근',
            };

            const result = reservationSchema.safeParse(validRes);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.purpose).toBe('외근');
            }
        });

        it('예약 목적 필드 자료형 오류 시 기본값 null로 보정하고 필수 필드 타입 불일치 시 catch() 복원한다', () => {
            const corruptRes = {
                organizationId: 999, // string에 number -> catch('')
                vehicleId: 'veh-777',
                reservedByUid: 'user-01',
                date: '2026-05-05',
                startTime: '09:00',
                endTime: '12:00',
                purpose: 12345, // string에 number -> catch(null)
            };
            const result = reservationSchema.safeParse(corruptRes);
            
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.organizationId).toBe('');
                expect(result.data.purpose).toBeNull();
            }
        });
    });
});
