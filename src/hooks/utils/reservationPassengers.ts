/**
 * 예약 동승자(예정) 값의 조립·복원 — 순수 함수로 단위 테스트 가능
 *
 * 같은 규칙을 세 곳이 함께 써야 한다: **예약 저장** · **예약 수정 화면 복원** ·
 * **운행일지 작성 화면 prefill**. 한 곳이라도 다르게 해석하면 "적어 둔 사람과
 * 채워지는 사람이 다른" 상태가 된다.
 *
 * 저장 형태(Reservation)와 입력 형태(ReservationForm)가 다른 점에 주의한다.
 *  - 저장: `passengerUids`(조직원) + `passengerNames`(**전원 이름**) + `passengerCount`(외부 인원 수)
 *  - 입력: `passengerUids` + `passengerExternalNames`(직접 입력 원문) + `passengerCount`
 * 저장 쪽에 전원 이름을 남기는 이유는 운행일지의 `passengerNames`와 형태를 맞추고,
 * 조직원이 퇴사·삭제된 뒤에도 "누가 타기로 했었는지"가 사라지지 않게 하기 위해서다.
 */
import type { User as UserDoc } from '../../types/user';
import type { Reservation, ReservationForm } from '../../types/reservation';

/** 동승자 이름 배열 길이 상한 — 서버(createReservationCore)와 같은 값을 쓴다 */
export const MAX_PASSENGERS = 50;

/** 조직원 표시 이름 (프로젝트 전역에서 쓰는 규칙) */
export const memberDisplayName = (m: UserDoc) => m.name || m.email?.split('@')[0] || '';

/** 쉼표로 구분된 원문을 이름 배열로 — 공백·빈 항목·중복 제거 */
export const parseExternalNames = (raw?: string): string[] => {
    if (!raw) return [];
    const seen = new Set<string>();
    const names: string[] = [];
    for (const part of raw.split(',')) {
        const name = part.trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        names.push(name);
    }
    return names;
};

/**
 * 폼 입력 → 예약 문서에 저장할 필드.
 *
 * 값이 없으면 **필드를 만들지 않는다**(문서를 불필요하게 키우지 않는다).
 * 다만 `clearWhenEmpty`를 켜면 빈 값을 명시적으로 내보낸다 — 수정에서 동승자를
 * 모두 지운 경우 `undefined`로 두면 `updateReservation`이 걸러 내 **옛 값이 남는다**.
 */
export function composeReservationPassengers(
    form: Pick<ReservationForm, 'passengerUids' | 'passengerExternalNames' | 'passengerCount'>,
    members: UserDoc[],
    { clearWhenEmpty = false }: { clearWhenEmpty?: boolean } = {},
): Pick<Reservation, 'passengerUids' | 'passengerNames' | 'passengerCount'> {
    const uids = (form.passengerUids || []).filter(uid => members.some(m => m.id === uid));
    const memberNames = uids
        .map(uid => memberDisplayName(members.find(m => m.id === uid)!))
        .filter(Boolean);
    const externalNames = parseExternalNames(form.passengerExternalNames);
    const names = [...memberNames, ...externalNames];
    const count = Math.max(0, Math.floor(form.passengerCount || 0));

    if (!uids.length && !names.length && !count) {
        return clearWhenEmpty ? { passengerUids: [], passengerNames: [], passengerCount: 0 } : {};
    }
    return {
        ...(uids.length ? { passengerUids: uids } : clearWhenEmpty ? { passengerUids: [] } : {}),
        ...(names.length ? { passengerNames: names.slice(0, MAX_PASSENGERS) } : clearWhenEmpty ? { passengerNames: [] } : {}),
        ...(count ? { passengerCount: count } : clearWhenEmpty ? { passengerCount: 0 } : {}),
    };
}

/**
 * 저장된 예약 → 화면에서 쓸 형태로 복원.
 *
 * uid를 먼저 맞추고, uid로 못 찾은 이름은 이름으로 한 번 더 맞춘다(구 데이터·개명 대비).
 * 그래도 남는 이름은 조직원이 아닌 사람이므로 직접 입력 칸으로 돌려보낸다 —
 * 퇴사한 직원의 이름이 조용히 사라지지 않게 하는 것이 이 폴백의 목적이다.
 */
export function resolveReservationPassengers(
    reservation: Pick<Reservation, 'passengerUids' | 'passengerNames' | 'passengerCount'> | null | undefined,
    members: UserDoc[],
): { selected: UserDoc[]; externalNames: string[]; count: number } {
    if (!reservation) return { selected: [], externalNames: [], count: 0 };

    const uids = reservation.passengerUids || [];
    const names = reservation.passengerNames || [];

    const byUid = members.filter(m => uids.includes(m.id));
    const matchedIds = new Set(byUid.map(m => m.id));
    const matchedNames = new Set(byUid.map(memberDisplayName));

    const byName = members.filter(m =>
        !matchedIds.has(m.id) && names.includes(memberDisplayName(m)),
    );
    byName.forEach(m => matchedNames.add(memberDisplayName(m)));

    return {
        selected: [...byUid, ...byName],
        externalNames: names.filter(n => !matchedNames.has(n)),
        count: Math.max(0, Math.floor(reservation.passengerCount || 0)),
    };
}
