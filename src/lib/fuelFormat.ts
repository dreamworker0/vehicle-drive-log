/**
 * 주유·충전량 표기 규칙.
 *
 * 주유기·충전기가 찍어 주는 값은 소수점 두세 자리가 끝인데, `<input type="number">`는
 * `step="0.001"`을 줘도 **타이핑을 막지 않는다**(step은 스피너 증감과 제출 시 검증에만
 * 걸린다). 그래서 `33.4545345` 같은 값이 그대로 저장되고, 목록·리포트에 길게 늘어져
 * 자릿수를 세어야 읽히는 화면이 됐다.
 *
 * 입력과 표시 양쪽을 여기서 함께 정한다 — 한쪽만 고치면 화면과 저장값이 어긋난다.
 */

/** 주유·충전량 소수점 자릿수. 주유기 눈금(0.01 L)보다 한 자리 더 준다. */
export const FUEL_DECIMALS = 3;

/**
 * 입력 중인 문자열에서 소수점 뒤 초과 자릿수를 잘라낸다.
 *
 * **반올림하지 않고 자른다.** 타이핑 도중 반올림하면 방금 누른 숫자 때문에 앞자리가
 * 바뀌어 보여 사용자가 자기 입력을 의심하게 된다. 입력 중 상태(`33.`, 빈 문자열)는
 * 그대로 흘려보내야 다음 글자를 계속 칠 수 있다.
 */
export function limitFuelDecimals(value: string): string {
    // 숫자·점 말고 다른 글자가 섞였으면 손대지 않는다. `<input type="number">`는 지수
    // 표기('1.23456e2')도 유효한 값으로 넘겨주는데, 그걸 소수부로 착각해 자르면
    // 123.456이 1.234가 된다 — 100배 어긋난 값이 조용히 저장된다.
    if (!/^\d*\.?\d*$/.test(value)) return value;
    const dot = value.indexOf('.');
    if (dot === -1) return value;
    // 두 번째 점부터는 버린다 — 붙여넣기로 '1.2.3'이 들어와도 소수부만 남긴다.
    const frac = value.slice(dot + 1).replace(/\..*$/, '').slice(0, FUEL_DECIMALS);
    return `${value.slice(0, dot)}.${frac}`;
}

/**
 * 저장된 주유·충전량을 화면·리포트에 찍을 문자열로 만든다.
 *
 * 이미 저장된 긴 값도 여기서 걸러진다(입력만 고치면 과거 기록은 계속 길게 나온다).
 * 불필요한 0은 남기지 않는다 — `40.500`이 아니라 `40.5`, `40.000`이 아니라 `40`.
 *
 * @returns 값이 없거나 숫자가 아니면 빈 문자열 (호출부에서 '-' 등으로 대체하기 쉽게)
 */
export function formatFuelAmount(value: number | string | null | undefined): string {
    if (value === null || value === undefined || value === '') return '';
    const num = Number(value);
    if (!Number.isFinite(num)) return '';
    return String(Number(num.toFixed(FUEL_DECIMALS)));
}

/**
 * 저장할 값으로 반올림한다.
 *
 * 입력 칸의 자릿수 제한만으로는 부족하다 — 기존 기록을 수정할 때 폼은 저장된 값을 그대로
 * 채우므로(`useFuelLog`의 편집 프리필), 주유금액만 고치고 저장하면 긴 주유량이 다시
 * 그대로 쓰인다. 저장 길목에서 한 번 더 맞춰야 "이제 셋째 자리까지만 들어간다"가 참이 된다.
 *
 * 자르지 않고 **반올림**하는 이유는 화면에 보이는 값(`formatFuelAmount`)과 저장값을
 * 일치시키기 위해서다. 입력 중에는 반대로 잘라야 한다(위 주석 참고).
 *
 * @returns 숫자로 만들 수 없으면 NaN — 호출부의 기존 검증이 이미 빈 값을 막는다.
 */
export function roundFuelAmount(value: number | string): number {
    const formatted = formatFuelAmount(value);
    return formatted === '' ? NaN : Number(formatted);
}
