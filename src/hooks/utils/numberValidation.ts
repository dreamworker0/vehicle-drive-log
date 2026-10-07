/**
 * 숫자 입력 검증 유틸 — 음수가 들어가면 안 되는 값을 저장 직전에 막는다.
 *
 * `<input type="number" min="0">`은 브라우저 기본 검증에만 의존하므로
 * 코드에서 폼을 직접 제출(`handleSubmit(new Event('submit'))`)하거나 `min`을 빠뜨리면
 * 그대로 음수가 통과한다. 실제 방어선은 각 훅의 저장 직전 검증이며, 그 검사를
 * 여기 한곳에 모아 폼마다 같은 문구로 안내한다.
 */

/**
 * 음수를 허용하지 않는 숫자 칸의 onChange 값을 정리한다.
 *
 * `min="0"`은 **저장 시점**에만 걸린다 — 타이핑·붙여넣기·스피너로 `-13`을 넣는 것은
 * 그대로 되고, 사용자는 저장 버튼을 누르고 나서야 잘못을 안다. 입력 즉시 마이너스 부호를
 * 떼어 화면에 음수가 아예 남지 않게 한다(마이너스 키를 누르지 않은 것처럼 동작).
 */
export function stripNegative(value: string): string {
    return value.startsWith('-') ? value.replace(/^-+/, '') : value;
}

/**
 * `<input type="number">`의 값을 **저장할 정수**로 읽는다.
 *
 * `parseInt`를 쓰면 안 된다. number 입력은 지수 표기(`1e5`)도 유효한 값으로 넘겨주는데
 * `parseInt('1e5')`는 앞에서부터 읽어 **1**을 돌려준다 — 100,000원이 1원으로, 50,000km가
 * 1km로 조용히 저장되는 경로다. 같은 함정을 `limitFuelDecimals`(lib/fuelFormat)가
 * 입력 단계에서 이미 경고해 두었는데, 저장 단계에는 그대로 남아 있었다.
 *
 * 더 나쁜 것은 **검증과 저장이 서로 다른 해석을 쓰던 것**이다. `validateNonNegativeFields`는
 * `Number`로 판정하므로 `1e5`는 100000으로 통과하고, 저장은 `parseInt`로 1이 된다 —
 * "검증을 통과한 값과 저장된 값이 다른" 상태가 만들어진다. 여기서 해석을 하나로 묶는다.
 *
 * 소수점은 버린다(원·km는 정수 단위). `parseInt`와 같은 결과이므로 기존 동작이 바뀌지 않는다.
 *
 * @returns 숫자로 만들 수 없으면 NaN — 빈 값·문자는 호출부의 기존 검증이 먼저 막는다.
 */
export function parseIntegerInput(value: string | number | null | undefined): number {
    if (value === '' || value === null || value === undefined) return NaN;
    const num = Number(value);
    return Number.isFinite(num) ? Math.trunc(num) : NaN;
}

/** 검증 대상 항목 — 라벨(사용자 안내 문구에 그대로 쓰인다) + 입력값 */
export interface NumericField {
    /** 폼에 표시되는 항목 이름. 예: '주유금액' */
    label: string;
    /** 폼 입력값. 빈 값(''·null·undefined)은 선택 항목으로 보고 건너뛴다. */
    value: string | number | null | undefined;
}

/**
 * 값이 비어 있지 않다면 숫자이면서 0 이상인지 검사한다.
 *
 * @returns 위반 시 사용자 안내 메시지, 모두 정상이면 null
 */
export function validateNonNegativeFields(fields: NumericField[]): string | null {
    for (const { label, value } of fields) {
        if (value === '' || value === null || value === undefined) continue;

        const num = Number(value);
        if (!Number.isFinite(num)) {
            return `${label}에 숫자만 입력할 수 있습니다.`;
        }
        if (num < 0) {
            return `${label}에 음수를 입력할 수 없습니다.`;
        }
    }
    return null;
}
