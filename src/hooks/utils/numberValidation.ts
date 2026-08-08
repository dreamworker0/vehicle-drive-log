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
