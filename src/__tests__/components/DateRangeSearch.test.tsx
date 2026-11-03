/**
 * DateRangeSearch — 일지 관리 기간 필터는 [검색]을 눌러야 조회한다
 *
 * 날짜가 바뀌는 즉시 조회하던 때는 달력 화살표로 달만 넘겨도 검색 결과가 바뀌어 헷갈렸다.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DateRangeSearch from '../../components/admin/DateRangeSearch';

const startInput = () => screen.getByLabelText('시작일') as HTMLInputElement;
const endInput = () => screen.getByLabelText('종료일') as HTMLInputElement;

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
