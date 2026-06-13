interface ToggleProps {
    /** 켜짐 여부 */
    checked: boolean;
    /** 토글 시 호출. 변경될 다음 값(!checked)을 인자로 받는다. */
    onChange: (next: boolean) => void;
    /** 접근성 라벨. 토글 옆에 보이는 텍스트 라벨이 없을 때 반드시 지정한다. */
    label?: string;
    /** 켜짐 상태 트랙 배경색 (Tailwind 클래스). 기본 primary. 의미상 다른 색이 필요할 때만 변경. */
    onClassName?: string;
    /** 비활성화 */
    disabled?: boolean;
}

/**
 * 공용 토글 스위치. 전 화면에서 동일한 크기·애니메이션을 보장한다.
 *
 * 트랙 h-7 w-12 / knob h-5 w-5 / translate-x-3 가 표준 규격이며,
 * before 가상요소로 48px 터치 영역을 확보한다. 이 규격은 직접 마크업하지 말고
 * 반드시 이 컴포넌트를 사용한다. → .agent/skills/shared-ui-controls 참고.
 */
export default function Toggle({
    checked,
    onChange,
    label,
    onClassName = 'bg-primary-600',
    disabled = false,
}: ToggleProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={`relative inline-flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-300 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed before:absolute before:-inset-y-2.5 before:content-[''] ${checked ? onClassName : 'bg-surface-200 dark:bg-surface-700'}`}
        >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-300 ${checked ? 'translate-x-3' : '-translate-x-3'}`} />
        </button>
    );
}
