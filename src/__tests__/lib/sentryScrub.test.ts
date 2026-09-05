import { describe, it, expect } from 'vitest';
import { scrubContext, scrubValues } from '@/lib/sentryScrub';

/**
 * Sentry `extra`에서 자유 입력이 걸러지는지 검증한다.
 *
 * 도메인 함수 20여 곳이 `captureError(error, { context, data })`로 **저장하려던 문서를
 * 통째로** 넘긴다. 목적지·동승자 이름·비고가 그대로 실리는 경로다. 여기서는 그 실제
 * 모양을 그대로 재현해, 지워야 할 것과 남아야 할 것을 함께 못박는다.
 */
describe('scrubContext', () => {
    it('운행일지 저장 실패 컨텍스트에서 자유 입력을 지우고 진단값은 남긴다', () => {
        // createDriveLog가 실패할 때 실제로 넘기는 모양 (mutations.ts)
        const out = scrubContext({
            context: 'createDriveLog',
            data: {
                organizationId: 'org1',
                vehicleId: 'v1',
                driverName: '홍길동',
                destination: '서울시청 앞 복지관',
                purpose: '이용자 병원 동행',
                notes: '김OO 어르신 정기 진료',
                passengerNames: ['김철수', '이영희'],
                startKm: 50000,
                endKm: 50050,
                isRetroactive: false,
            },
        });

        const data = out.data as Record<string, unknown>;

        // 자유 입력은 값이 사라진다
        expect(data.driverName).not.toContain('홍길동');
        expect(data.destination).not.toContain('서울');
        expect(data.purpose).not.toContain('병원');
        expect(data.notes).not.toContain('어르신');
        expect(JSON.stringify(data.passengerNames)).not.toContain('김철수');

        // 진단에 필요한 것은 남는다
        expect(out.context).toBe('createDriveLog');
        expect(data.organizationId).toBe('org1');
        expect(data.vehicleId).toBe('v1');
        expect(data.startKm).toBe(50000);
        expect(data.endKm).toBe(50050);
        expect(data.isRetroactive).toBe(false);
    });

    it('값을 지우되 진단에 쓰는 모양(타입·길이)은 남긴다', () => {
        // "빈 값이라 실패했는지, 너무 길어서 실패했는지"가 원인 판별의 핵심이다.
        const out = scrubContext({ context: 'x', data: { notes: '', destination: '열두글자짜리목적지입니다' } });
        const data = out.data as Record<string, string>;

        expect(data.notes).toBe('[redacted string(0)]');
        expect(data.destination).toMatch(/^\[redacted string\(\d+\)\]$/);
    });

    it('중첩 객체와 배열 안쪽까지 적용된다', () => {
        const out = scrubContext({
            context: 'createReservation',
            data: {
                passengers: [
                    { uid: 'u1', name: '홍길동', email: 'a@b.com' },
                    { uid: 'u2', name: '김철수', email: 'c@d.com' },
                ],
            },
        });

        const serialized = JSON.stringify(out);
        expect(serialized).not.toContain('홍길동');
        expect(serialized).not.toContain('a@b.com');
        // 같은 깊이의 식별자는 살아남아야 문제를 좁힐 수 있다
        expect(serialized).toContain('u1');
        expect(serialized).toContain('u2');
    });

    it('이메일은 최상위 키로 넘겨도 지운다', () => {
        const out = scrubContext({ context: 'inviteUser', email: 'jw@example.com', orgId: 'org1' });
        expect(out.email).not.toContain('example.com');
        expect(out.orgId).toBe('org1');
    });

    it('날짜와 컴포넌트 스택은 남긴다', () => {
        const out = scrubContext({
            context: 'ErrorBoundary',
            date: '2026-09-05',
            startDate: '2026-09-01',
            componentStack: '\n    at AdminDashboard\n    at ErrorBoundary',
        });

        expect(out.date).toBe('2026-09-05');
        expect(out.startDate).toBe('2026-09-01');
        expect(out.componentStack).toContain('AdminDashboard');
    });

    it('Error와 Date는 읽을 수 있는 형태로 남긴다', () => {
        const out = scrubContext({
            context: 'x',
            cause: new Error('permission-denied'),
            occurredAt: new Date('2026-09-05T01:00:00.000Z'),
        });

        expect(out.cause).toBe('Error: permission-denied');
        expect(out.occurredAt).toBe('2026-09-05T01:00:00.000Z');
    });

    it('순환 참조·깊은 중첩·긴 배열에도 죽지 않는다', () => {
        const circular: Record<string, unknown> = { context: 'x', orgId: 'org1' };
        circular.self = circular;

        expect(() => scrubContext(circular)).not.toThrow();
        expect(JSON.stringify(scrubContext(circular))).toContain('circular');

        let deep: Record<string, unknown> = { name: '홍길동' };
        for (let i = 0; i < 10; i++) deep = { nested: deep };
        const deepOut = JSON.stringify(scrubContext({ context: 'x', data: deep }));
        expect(deepOut).not.toContain('홍길동');

        const long = Array.from({ length: 100 }, (_, i) => `이름${i}`);
        const longOut = JSON.stringify(scrubContext({ context: 'x', names: long }));
        expect(longOut).not.toContain('이름3');
        expect(longOut).toContain('more');
    });

    it('빈 컨텍스트를 그대로 통과시킨다', () => {
        expect(scrubContext({})).toEqual({});
    });

    it('일반 명사 키(reason·type·key)에 실린 자유 입력도 지운다', () => {
        // 허용 목록이 일반 명사를 담으면 차단 목록과 똑같은 방식으로 뚫린다.
        // 실제로 retireVehicle이 관리자가 입력한 폐차 사유 원문을 reason으로 넘기고 있었다.
        const out = scrubContext({
            context: 'retireVehicle',
            vehicleId: 'v1',
            reason: '대표 김철수 개인 사고로 전손 폐차, 보험사 연락처 010-1234-5678',
            type: '대표자 자택 방문',
            key: '홍길동-집',
        });

        const serialized = JSON.stringify(out);
        expect(serialized).not.toContain('김철수');
        expect(serialized).not.toContain('010-1234-5678');
        expect(serialized).not.toContain('홍길동');
        expect(serialized).not.toContain('자택');
        expect(out.vehicleId).toBe('v1');
    });

    it('안전한 키 아래 깊은 곳의 일반 명사 키도 지운다', () => {
        // schemas/index.ts가 Zod 파싱 실패 시 문서 전체를 rawData로 넘긴다.
        const out = scrubContext({
            docId: 'o1',
            path: 'organizations/o1',
            rawData: {
                name: '○○복지관',
                aiVerifyDetail: {
                    reason: '동일한 고유번호(123-45-67890)로 이미 승인된 기관이 있습니다.',
                },
                retired: { reason: '노후화 및 담당자 김철수 퇴사' },
            },
        });

        const serialized = JSON.stringify(out);
        expect(serialized).not.toContain('123-45-67890');
        expect(serialized).not.toContain('김철수');
        expect(serialized).not.toContain('복지관');
        expect(out.docId).toBe('o1');
    });

    it('허용 키라도 값이 이메일·전화번호 모양이면 지운다', () => {
        // googleCalendarId는 *Id로 끝나지만 실제로는 계정 이메일일 수 있다.
        const out = scrubContext({
            context: 'updateVehicle',
            vehicleId: 'v1',
            googleCalendarId: 'jw@sasw.or.kr',
            componentStack: '문의 010-9876-5432 로 연락',
        });

        expect(out.googleCalendarId).not.toContain('sasw.or.kr');
        expect(out.componentStack).not.toContain('010-9876-5432');
        expect(out.vehicleId).toBe('v1');
    });

    it('진단 전용 코드값은 남긴다', () => {
        const out = scrubContext({
            context: 'x',
            appCheckCode: 'appCheck/throttled',
            scope: 'userDoc',
            dataset: 'driveLogs',
            format: 'pdf',
            requirement: 'admin',
            retryKey: 'approve-res-r1',
        });

        expect(out.appCheckCode).toBe('appCheck/throttled');
        expect(out.scope).toBe('userDoc');
        expect(out.dataset).toBe('driveLogs');
        expect(out.format).toBe('pdf');
        expect(out.requirement).toBe('admin');
        expect(out.retryKey).toBe('approve-res-r1');
    });

    it('값 하나가 읽히지 않아도 형제 값은 잃지 않는다', () => {
        const out = scrubContext({
            context: 'createDriveLog',
            orgId: 'org1',
            data: { get boom(): string { throw new Error('nope'); }, vehicleId: 'v1' },
        });

        expect(out.context).toBe('createDriveLog');
        expect(out.orgId).toBe('org1');
        const data = out.data as Record<string, unknown>;
        expect(data.boom).toBe('[unreadable]');
        expect(data.vehicleId).toBe('v1');
    });

    it('형제 자리에 같은 객체가 두 번 와도 순환으로 보지 않는다', () => {
        const shared = { vehicleId: 'v1' };
        const out = scrubContext({ context: 'x', a: shared, b: shared });

        expect(out.a).toEqual({ vehicleId: 'v1' });
        expect(out.b).toEqual({ vehicleId: 'v1' });
    });

    it('scrubValues는 키 없는 값 목록을 모두 차단한다', () => {
        const out = scrubValues(['[submitDriveLog] 실패', { destination: '서울역', vehicleId: 'v1' }]);
        const serialized = JSON.stringify(out);
        expect(serialized).not.toContain('서울역');
        expect(serialized).not.toContain('submitDriveLog');
        expect(serialized).toContain('v1');
    });
});
