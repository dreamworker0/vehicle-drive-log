/**
 * destinationGuard — 목적지·목적 칸이 "그럴듯하게 틀린 채" 저장되는 것을 막는다.
 *
 * 운행일지는 PDF·Excel로 뽑혀 지출결의·감사 서류가 된다. 그런데 이 폼은 예약에서 넘어온 값을
 * 그대로 채워 두고, 제출 버튼은 차량·출발km·도착km만 본다. 미리 채워진 값이 그럴듯하면
 * 운전자는 의심하지 않고 넘어간다 — 빈칸이면 채웠을 텐데.
 *
 * 실제로 그 길로 **차량 이름이 목적지로 저장**됐다. 구글 캘린더에 제목을 "스파크"라고만 적으면
 * 역동기화가 그것을 목적지로 읽어 예약에 넣었고(입구는 `calendarSync`에서 막았다), 일지가
 * 그 값을 물려받았다. 입구를 막아도 사람이 직접 적는 길은 남으므로 출구에도 그물을 둔다.
 *
 * 강도를 둘로 나눈 이유: **차량명은 의도일 수 없고**(목적지 칸에 탄 차를 적는 사람은 없다),
 * **빈칸은 의도일 수 있다**(급할 때 비워 두고 나중에 채운다). 앞은 막고 뒤는 한 번 묻는다.
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

/**
 * 운행 목적이 비었는가 — 한 번 물어볼 대상. **막지는 않는다.**
 *
 * 목적지는 여기서 보지 않는다. [driveLogValidation.ts](../utils/driveLogValidation.ts)의
 * `validateDriveLogForm`이 이미 필수로 막고 있어, 빈 목적지는 이 지점에 도달하지 못한다.
 * 도달하지 않는 분기를 넣어 두면 다음 사람이 그 조건을 살아 있는 규칙으로 읽는다.
 *
 * 반대로 **목적은 비어도 그대로 저장된다.** 캘린더에서 넘어온 예약은 설명란에 `용도:` 줄이
 * 없으면 목적이 빈 채로 오고, 그 값이 폼에 그대로 채워진 뒤 저장된다.
 *
 * 수정 모드에서는 부르지 않는다 — 과거 기록을 손보는 중이라 빈칸이 의도인 경우가 많고,
 * 여기서 붙잡으면 정정 자체를 방해한다.
 */
export function isPurposeMissing(form: { purpose?: string }): boolean {
    return !(form.purpose || '').trim();
}
