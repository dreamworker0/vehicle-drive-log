/**
 * 스키마 필드 누락 회귀 테스트
 *
 * `createZodConverter`의 `fromFirestore`는 Zod가 모르는 키를 **조용히 제거한다**(z.object 기본 동작).
 * 그래서 스키마에 필드를 빠뜨리면 저장은 되는데 앱에서는 항상 undefined가 되고, 타입 선언과
 * 스키마가 따로 놀던 시절에는 이게 컴파일 에러 없이 통과했다. 실제로 아래 필드들이 그렇게
 * 죽어 있었다 — 차량 배터리 배지와 예약 캘린더 배지는 코드가 멀쩡한데 화면에 뜨지 않았다.
 *
 * 지금은 타입이 스키마에서 파생되므로 같은 방식의 어긋남은 컴파일 단계에서 잡힌다. 이 테스트는
 * 그 위에 한 겹 더 두는 것이다 — **필드가 실제로 컨버터를 통과해 나오는지**는 타입이 보장하지
 * 못하고(스키마에서 지우면 타입도 같이 사라져 조용히 통과한다), 여기서만 확인할 수 있다.
 */
import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import {
    createZodConverter,
    vehicleSchema,
    reservationSchema,
    userSchema,
    organizationSchema,
} from '../../schemas';
import type { QueryDocumentSnapshot } from 'firebase/firestore';

/** 컨버터를 통과시킨 결과를 돌려준다 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readThrough(schema: any, data: Record<string, unknown>) {
    const snapshot = {
        id: 'doc-1',
        ref: { path: 'test/doc-1' },
        data: () => data,
    } as unknown as QueryDocumentSnapshot;
    return createZodConverter(schema).fromFirestore(snapshot) as Record<string, unknown>;
}

describe('스키마가 앱이 실제로 쓰는 필드를 모두 담는다', () => {
    it('차량: 배터리 잔량·보험 알림 마커·캘린더 실패 시각이 컨버터를 통과한다', () => {
        const result = readThrough(vehicleSchema, {
            organizationId: 'org1',
            name: '스타렉스',
            plateNumber: '12가 3456',
            currentKm: 1000,
            fuelType: 'electric',
            // 차량 관리 목록의 🔋 배지가 읽는 값 — 스키마에 없어 컨버터가 지우고 있었다
            currentBattery: 78,
            insuranceExpiryNotifiedFor: '2026-12-31',
            calendarSyncLastFailAt: Timestamp.fromDate(new Date('2026-03-05T00:00:00Z')),
        });

        expect(result.currentBattery).toBe(78);
        expect(result.insuranceExpiryNotifiedFor).toBe('2026-12-31');
        expect(result.calendarSyncLastFailAt).toBeDefined();
    });

    it('차량: 모델명이 비어도 문서 전체가 파싱 실패하지 않는다', () => {
        const result = readThrough(vehicleSchema, {
            organizationId: 'org1',
            name: '스타렉스',
            plateNumber: '12가 3456',
            currentKm: 1000,
        });

        expect(result.modelName).toBeUndefined();
        // 파싱이 실패했다면 plateNumber 폴백('번호 없음')이 아니라 원시 값이 그대로 나온다.
        // 여기서 확인하는 건 "실패 폴백 경로로 새지 않았다"는 것.
        expect(result.organizationId).toBe('org1');
    });

    it('예약: 캘린더 동기화 출처·연결 이벤트·출발 계기판·반려 시각이 컨버터를 통과한다', () => {
        const result = readThrough(reservationSchema, {
            organizationId: 'org1',
            vehicleId: 'v1',
            reservedByUid: 'u1',
            date: '2026-03-05',
            startTime: '09:00',
            endTime: '12:00',
            status: 'reserved',
            // 예약 목록의 📅 배지가 읽는 값 — 스키마에 없어 컨버터가 지우고 있었다
            syncSource: 'calendar',
            calendarEventId: 'ev-1',
            currentKm: 51000,
            rejectedAt: Timestamp.fromDate(new Date('2026-03-04T00:00:00Z')),
        });

        expect(result.syncSource).toBe('calendar');
        expect(result.calendarEventId).toBe('ev-1');
        expect(result.currentKm).toBe(51000);
        expect(result.rejectedAt).toBeDefined();
    });

    it('예약: 알 수 없는 상태는 예약됨으로 읽어 시간대를 계속 막는다', () => {
        const result = readThrough(reservationSchema, {
            organizationId: 'org1',
            vehicleId: 'v1',
            reservedByUid: 'u1',
            date: '2026-03-05',
            startTime: '09:00',
            endTime: '12:00',
            status: 'some-unknown-status',
        });

        expect(result.status).toBe('reserved');
    });

    it('사용자: FCM 토큰이 컨버터를 통과한다', () => {
        const result = readThrough(userSchema, {
            name: '홍길동',
            email: 'a@b.c',
            role: 'employee',
            organizationId: 'org1',
            fcmToken: 'token-abc',
        });

        expect(result.fcmToken).toBe('token-abc');
    });

    it('기관: 지도 좌표가 컨버터를 통과한다', () => {
        const result = readThrough(organizationSchema, {
            name: '테스트기관',
            applicantUid: 'u1',
            status: 'approved',
            lat: 37.5665,
            lng: 126.978,
        });

        expect(result.lat).toBeCloseTo(37.5665);
        expect(result.lng).toBeCloseTo(126.978);
    });

    it('컨버터는 스키마에 없는 키를 조용히 제거한다 — 이 테스트들이 필요한 이유', () => {
        const result = readThrough(userSchema, {
            name: '홍길동',
            email: 'a@b.c',
            role: 'employee',
            organizationId: 'org1',
            somethingNobodyDeclared: '사라진다',
        });

        expect(result.somethingNobodyDeclared).toBeUndefined();
    });
});
