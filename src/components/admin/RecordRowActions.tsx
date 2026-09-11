/**
 * RecordRowActions — 관리자 일지 목록 행의 수정·삭제 버튼
 *
 * 주유일지·하이패스일지가 같은 모양의 행 버튼을 쓰는데, 각 목록이 모바일·데스크탑
 * 두 벌의 마크업을 들고 있어 같은 아이콘 SVG가 화면마다 두 번씩 박혀 있었다.
 * 수정 버튼을 더하면서 네 벌이 되므로 여기로 모은다.
 */
import { memo } from 'react';

interface Props {
    onEdit: () => void;
    onDelete: () => void;
    /** 버튼 묶음 정렬 (기본: 가운데) */
    className?: string;
}

export default memo(function RecordRowActions({ onEdit, onDelete, className = 'justify-center' }: Props) {
    return (
        <div className={`flex items-center ${className}`}>
            <button
                onClick={onEdit}
                className="p-1.5 rounded-lg text-surface-300 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors min-h-[48px] min-w-[44px] flex items-center justify-center"
                title="수정"
                aria-label="기록 수정"
            >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                </svg>
            </button>
            <button
                onClick={onDelete}
                className="p-1.5 rounded-lg text-surface-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors min-h-[48px] min-w-[44px] flex items-center justify-center"
                title="삭제"
                aria-label="기록 삭제"
            >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                </svg>
            </button>
        </div>
    );
});
