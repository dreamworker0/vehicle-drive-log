import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ReservationCard from '../../components/employee/ReservationCard';
import { resolveOrgSites } from '../../lib/orgSites';
import type { Vehicle } from '../../types/vehicle';
import type { Reservation } from '../../types/reservation';

/**
 * 차 위치가 필요한 순간은 예약을 만들 때가 아니라 **차를 가지러 갈 때**다. 그래서 표시는
 * 오늘의 예약 카드에만 넣는다.
 *
 * 회귀 지점은 두 가지다.
 * ① 분관을 등록하지 않은 기관에는 배지가 아예 나오지 않는다.
 * ② 고정 출발지 차량에는 확인 시각을 붙이지 않는다 — 바뀌지도 않는 값에 낡음을 암시하면
 *    불필요한 의심만 만든다.
 */
const SITES = resolveOrgSites({
    address: '서울시 본관로 1',
    sites: [
        { id: 'site_a', name: '제2분관', address: '경기도 분관로 2' },
        { id: 'site_b', name: '숙소', address: '경기도 숙소로 3' },
    ],
});
const MAIN_ONLY = resolveOrgSites({ address: '서울시 본관로 1' });

const RESERVATION = {
    id: 'r1', vehicleId: 'v1', vehicleName: '스타렉스',
    date: '2026-09-04', startTime: '09:00', endTime: '11:00',
    status: 'confirmed', destination: '서울시청',
} as unknown as Reservation;

function vehicle(over: Partial<Vehicle> = {}): Vehicle {
    return { id: 'v1', displayName: '스타렉스', vehicleType: 'van', ...over } as Vehicle;
}

function renderCard(over: {
    orgSites?: typeof SITES;
    vehicle?: Vehicle;
    isInProgress?: boolean;
    refuelFlagEnabled?: boolean;
} = {}) {
    return render(
        <ReservationCard
            reservation={RESERVATION}
            vehicle={over.vehicle ?? vehicle()}
            isInProgress={over.isInProgress ?? false}
            disabled={false}
            startingId={null}
            onStartDrive={() => { }}
            onArrival={() => { }}
            orgSites={over.orgSites ?? SITES}
            refuelFlagEnabled={over.refuelFlagEnabled ?? false}
        />
    );
}

describe('오늘의 예약 카드 — 차량 현재 위치 배지', () => {
    it('분관을 등록하지 않은 기관에는 나오지 않는다', () => {
        renderCard({ orgSites: MAIN_ONLY, vehicle: vehicle({ siteId: 'site_a' }) });
        expect(screen.queryByTestId('vehicle-site-badge')).toBeNull();
    });

    it('고정 출발지 차량은 기본 차고지 이름만 보여 준다 — 늘 거기 있으므로 시각은 의미가 없다', () => {
        renderCard({
            vehicle: vehicle({
                siteId: 'site_a',
                currentSiteUpdatedAt: new Date('2026-09-01T17:20:00'),
            }),
        });
        const badge = screen.getByTestId('vehicle-site-badge');
        expect(badge.textContent).toContain('제2분관');
        expect(badge.textContent).not.toContain('기준');
    });

    it('유동 차량은 현재 위치와 확인 시각을 함께 보여 준다', () => {
        renderCard({
            vehicle: vehicle({
                siteVaries: true,
                siteId: 'site_a',
                currentSiteId: 'site_b',
                currentSiteUpdatedAt: new Date('2026-09-01T17:20:00'),
            }),
        });
        const badge = screen.getByTestId('vehicle-site-badge');
        expect(badge.textContent).toContain('숙소');
        expect(badge.textContent).toContain('9/1 17:20 기준');
    });

    it('유동 차량인데 아직 기록이 없으면 시각 없이 이름만 보여 준다', () => {
        renderCard({ vehicle: vehicle({ siteVaries: true, siteId: 'site_a' }) });
        const badge = screen.getByTestId('vehicle-site-badge');
        expect(badge.textContent).toContain('제2분관');
        expect(badge.textContent).not.toContain('기준');
    });

    it('운행 중인 차는 위치 대신 운행 중임을 보여 준다 — 어느 주차장에도 없다', () => {
        renderCard({
            isInProgress: true,
            vehicle: vehicle({
                siteVaries: true,
                currentSiteId: 'site_b',
                currentSiteUpdatedAt: new Date('2026-09-01T17:20:00'),
            }),
        });
        const badge = screen.getByTestId('vehicle-site-badge');
        expect(badge.textContent).toContain('운행 중');
        expect(badge.textContent).not.toContain('숙소');
    });
});

describe('오늘의 예약 카드 — 주유·충전 필요 배지', () => {
    it('기관이 기능을 끄면 차량에 표시가 켜져 있어도 나오지 않는다', () => {
        renderCard({ vehicle: vehicle({ needsRefuel: true }), refuelFlagEnabled: false });
        expect(screen.queryByTestId('vehicle-refuel-badge')).toBeNull();
    });

    it('기능을 켠 기관에서 표시된 차량이면 안내가 뜬다', () => {
        renderCard({ vehicle: vehicle({ needsRefuel: true }), refuelFlagEnabled: true });
        expect(screen.getByTestId('vehicle-refuel-badge').textContent).toContain('주유 필요');
    });

    it('표시되지 않은 차량에는 나오지 않는다', () => {
        renderCard({ vehicle: vehicle(), refuelFlagEnabled: true });
        expect(screen.queryByTestId('vehicle-refuel-badge')).toBeNull();
    });

    it('언제 표시된 것인지 함께 보여 준다 — 몇 달 묵은 표시와 구분되어야 한다', () => {
        renderCard({
            vehicle: vehicle({ needsRefuel: true, needsRefuelAt: new Date('2026-09-05T17:20:00') }),
            refuelFlagEnabled: true,
        });
        expect(screen.getByTestId('vehicle-refuel-badge').textContent).toContain('9/5 표시');
    });

    it('표시 시각이 없으면 안내만 보여 준다', () => {
        renderCard({ vehicle: vehicle({ needsRefuel: true }), refuelFlagEnabled: true });
        const badge = screen.getByTestId('vehicle-refuel-badge');
        expect(badge.textContent).toContain('주유 필요');
        expect(badge.textContent).not.toContain('표시');
    });

    it('전기차는 "충전 필요"로 부른다', () => {
        renderCard({
            vehicle: vehicle({ needsRefuel: true, fuelType: 'electric' }),
            refuelFlagEnabled: true,
        });
        expect(screen.getByTestId('vehicle-refuel-badge').textContent).toContain('충전 필요');
    });
});

/**
 * 직전 운전자가 비고에 적어 둔 주차 위치는, 차를 가지러 **가기 전에** 보여야 쓸모가 있다
 * (운행일지 작성 화면은 운행이 끝난 뒤에 열린다). 그래서 이 카드가 그 자리를 맡는다.
 *
 * 회귀 지점은 낡음이다. 일지가 지워지거나 보존기간이 지나도 차량 문서의 사본은 남으므로,
 * 14일 컷이 무너지면 몇 달 전 주차 위치가 오늘의 안내인 척 뜬다.
 */
describe('오늘의 예약 카드 — 직전 운행 비고', () => {
    const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
    /** 14일 컷은 실제 현재 시각으로 도므로, 고정 날짜를 단언하는 테스트는 시각을 붙들어야 한다.
     *  안 그러면 그 날짜로부터 14일이 지난 어느 날 무관한 커밋의 CI가 빨개진다. */
    const FIXED_NOW = new Date('2026-09-15T18:00:00');

    it('비고를 적지 않았으면 줄 자체가 나오지 않는다', () => {
        renderCard({ vehicle: vehicle() });
        expect(screen.queryByTestId('vehicle-last-note')).toBeNull();
    });

    it('공백만 적힌 비고도 없는 것으로 본다', () => {
        renderCard({ vehicle: vehicle({ lastDriveNote: '   ', lastDriveNoteAt: daysAgo(1) }) });
        expect(screen.queryByTestId('vehicle-last-note')).toBeNull();
    });

    it('최근 비고는 직전 운전자와 시각을 함께 보여 준다', () => {
        vi.useFakeTimers();
        vi.setSystemTime(FIXED_NOW);
        try {
            renderCard({
                vehicle: vehicle({
                    lastDriveNote: '타워 3층 B-12',
                    lastDriveNoteBy: '홍길동',
                    lastDriveNoteAt: new Date('2026-09-15T17:20:00'),
                }),
            });
            const note = screen.getByTestId('vehicle-last-note');
            expect(note.textContent).toContain('타워 3층 B-12');
            expect(note.textContent).toContain('홍길동');
            expect(note.textContent).toContain('9/15 17:20');
        } finally {
            vi.useRealTimers();
        }
    });

    it('14일이 지난 비고는 띄우지 않는다 — 2주 전 주차 위치는 오정보다', () => {
        renderCard({ vehicle: vehicle({ lastDriveNote: '타워 3층 B-12', lastDriveNoteAt: daysAgo(15) }) });
        expect(screen.queryByTestId('vehicle-last-note')).toBeNull();
    });

    // 아래 둘은 컷이 하루 밀리거나 당겨지는 오프바이원을 잡는다.
    it('경계 안쪽(13일)은 아직 보여 준다', () => {
        renderCard({ vehicle: vehicle({ lastDriveNote: '13일 전', lastDriveNoteAt: daysAgo(13) }) });
        expect(screen.getByTestId('vehicle-last-note').textContent).toContain('13일 전');
    });

    it('경계를 막 넘기면(14일 + 1분) 사라진다', () => {
        renderCard({
            vehicle: vehicle({
                lastDriveNote: '방금 넘김',
                lastDriveNoteAt: new Date(Date.now() - (14 * 24 * 60 + 1) * 60 * 1000),
            }),
        });
        expect(screen.queryByTestId('vehicle-last-note')).toBeNull();
    });

    it('시각을 모르는 비고는 띄우지 않는다 — 낡음을 판단할 수 없다', () => {
        renderCard({ vehicle: vehicle({ lastDriveNote: '타워 3층 B-12' }) });
        expect(screen.queryByTestId('vehicle-last-note')).toBeNull();
    });

    it('운행 중에는 띄우지 않는다 — 차는 이미 내 손에 있다', () => {
        renderCard({
            isInProgress: true,
            vehicle: vehicle({ lastDriveNote: '타워 3층 B-12', lastDriveNoteAt: daysAgo(1) }),
        });
        expect(screen.queryByTestId('vehicle-last-note')).toBeNull();
    });
});
