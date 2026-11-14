/**
 * DateRangeSearch — 일지 관리 기간 필터는 [검색]을 눌러야 조회한다
 *
 * 날짜가 바뀌는 즉시 조회하던 때는 달력 화살표로 달만 넘겨도 검색 결과가 바뀌어 헷갈렸다.
 */
import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DateRangeSearch from '../../components/admin/DateRangeSearch';

const startInput = () => screen.getByLabelText('시작일') as HTMLInputElement;
const endInput = () => screen.getByLabelText('종료일') as HTMLInputElement;

/** 실제 화면처럼 [검색] 결과를 적용된 기간으로 되돌려 주는 부모 */
function Harness() {
    const [range, setRange] = useState({ start: '2026-11-01', end: '2026-11-30' });
    return (
        <DateRangeSearch
            startDate={range.start}
            endDate={range.end}
            onSearch={(start, end) => setRange({ start, end })}
        />
    );
}

describe('DateRangeSearch', () => {
    it('날짜를 바꾸기만 해서는 조회하지 않는다', () => {
        const onSearch = vi.fn();
        render(<DateRangeSearch startDate="2026-11-01" endDate="2026-11-30" onSearch={onSearch} />);

        fireEvent.change(startInput(), { target: { value: '2026-10-01' } });
        fireEvent.change(endInput(), { target: { value: '2026-10-31' } });

        expect(onSearch).not.toHaveBeenCalled();
        expect(startInput().value).toBe('2026-10-01');
    });

    it('[검색]을 누르면 고른 기간으로 조회한다', () => {
        const onSearch = vi.fn();
        render(<DateRangeSearch startDate="2026-11-01" endDate="2026-11-30" onSearch={onSearch} />);

        fireEvent.change(startInput(), { target: { value: '2026-10-01' } });
        fireEvent.change(endInput(), { target: { value: '2026-10-31' } });
        fireEvent.click(screen.getByRole('button', { name: '검색' }));

        expect(onSearch).toHaveBeenCalledWith('2026-10-01', '2026-10-31');
    });

    it('날짜 칸에서 Enter를 눌러도 조회한다', () => {
        const onSearch = vi.fn();
        render(<DateRangeSearch startDate="2026-11-01" endDate="2026-11-30" onSearch={onSearch} />);

        fireEvent.change(startInput(), { target: { value: '2026-10-01' } });
        fireEvent.submit(startInput().form!);

        expect(onSearch).toHaveBeenCalledWith('2026-10-01', '2026-11-30');
    });

    it('적용된 기간이 바깥에서 바뀌면(초기화) 입력 중이던 날짜를 버린다', () => {
        const { rerender } = render(<DateRangeSearch startDate="2026-11-01" endDate="2026-11-30" onSearch={vi.fn()} />);
        fireEvent.change(startInput(), { target: { value: '2026-10-01' } });

        rerender(<DateRangeSearch startDate="" endDate="" onSearch={vi.fn()} />);

        expect(startInput().value).toBe('');
        expect(endInput().value).toBe('');
    });

    it('[검색]으로 새 기간을 적용해도 포커스가 버튼에 남는다', () => {
        // 예전에는 key로 폼을 다시 만들어 포커스가 body로 튕겼다 — 키보드 사용자가 위치를 잃었다
        render(<Harness />);
        fireEvent.change(startInput(), { target: { value: '2026-10-01' } });
        const button = screen.getByRole('button', { name: '검색' });
        button.focus();

        fireEvent.submit(button.closest('form')!);

        expect(document.activeElement).toBe(button);
        expect(button.isConnected).toBe(true);
    });

    it('날짜 칸에서 Enter로 적용해도 포커스가 그 칸에 남는다', () => {
        render(<Harness />);
        const input = startInput();
        fireEvent.change(input, { target: { value: '2026-10-01' } });
        input.focus();

        fireEvent.submit(input.form!);

        expect(document.activeElement).toBe(input);
        expect(input.value).toBe('2026-10-01');
    });

    it('적용하지 않은 날짜가 있으면 글로도 알리고, 적용하면 지운다', () => {
        render(<Harness />);
        const status = screen.getByRole('status');
        expect(status.textContent).toBe('');

        fireEvent.change(startInput(), { target: { value: '2026-10-01' } });
        expect(status.textContent).toContain('[검색]을 눌러야');
        // 화면낭독기가 버튼에서 같은 안내를 듣도록 연결한다
        expect(screen.getByRole('button', { name: '검색' }).getAttribute('aria-describedby')).toBe(status.id);

        fireEvent.click(screen.getByRole('button', { name: '검색' }));
        expect(status.textContent).toBe('');
        expect(screen.getByRole('button', { name: '검색' }).hasAttribute('aria-describedby')).toBe(false);
    });

    it('옆에 붙인 초기화 버튼은 조회를 일으키지 않는다', () => {
        const onSearch = vi.fn();
        const onReset = vi.fn();
        render(
            <DateRangeSearch startDate="2026-11-01" endDate="2026-11-30" onSearch={onSearch}>
                <button type="button" onClick={onReset}>초기화</button>
            </DateRangeSearch>,
        );

        fireEvent.click(screen.getByRole('button', { name: '초기화' }));

        expect(onReset).toHaveBeenCalled();
        expect(onSearch).not.toHaveBeenCalled();
    });
});
