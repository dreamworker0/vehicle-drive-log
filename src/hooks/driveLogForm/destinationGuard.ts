/**
 * destinationGuard — 목적지 칸이 "그럴듯하게 틀린 채" 저장되는 것을 막는다.
 *
 * 운행일지는 PDF·Excel로 뽑혀 지출결의·감사 서류가 된다. 그런데 이 폼은 예약에서 넘어온 값을
 * 그대로 채워 두고, 제출 버튼은 차량·출발km·도착km만 본다. 미리 채워진 값이 그럴듯하면
 * 운전자는 의심하지 않고 넘어간다 — 빈칸이면 채웠을 텐데.
 *
 * 실제로 그 길로 **차량 이름이 목적지로 저장**됐다. 구글 캘린더에 제목을 "스파크"라고만 적으면
 * 역동기화가 그것을 목적지로 읽어 예약에 넣었고(입구는 `calendarSync`에서 막았다), 일지가
 * 그 값을 물려받았다. 입구를 막아도 사람이 직접 적는 길은 남으므로 출구에도 그물을 둔다.
 *
 * **목적(purpose)은 여기서 보지 않는다.** 한때 빈 목적도 함께 물었는데, 신고된 적 없는 칸을
 * 신고된 버그에 얹은 것이었다. 목적은 원래 선택 항목이고(스키마도 `optional`), 급할 때
 * 비워 두는 사용이 실제로 있다 — 매 운행마다 확인을 하나 더 세울 만한 값이 아니었다.
 */

/** 비교용 정규화 — 공백을 모두 지우고 소문자로. 서버 쪽 판정과 같은 규칙이다. */
function normalize(value: string): string {
    return value.replace(/\s+/g, '').toLowerCase();
}

export interface VehicleNameSource {
    displayName?: string;
    name?: string;
    plateNumber?: string;
}

/**
 * 목적지가 **그 차량 자신의 이름**인가. 맞으면 화면에 보여 줄 그 이름을, 아니면 `null`을 준다.
 *
 * 완전 일치만 본다 — "스파크 정비소"는 진짜 목적지다. 비교할 이름이 없으면 판정하지 않는다.
 */
export function findVehicleNameAsDestination(
    destination: string | undefined,
    vehicle: VehicleNameSource | null | undefined,
): string | null {
    const target = normalize(destination || '');
    if (!target) return null;

    const aliases = [vehicle?.displayName, vehicle?.name, vehicle?.plateNumber]
        .filter((v): v is string => typeof v === 'string' && v.trim() !== '');

    return aliases.find(alias => normalize(alias) === target) ?? null;
}
