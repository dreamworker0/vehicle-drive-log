/**
 * LogExportButtons — 관리자 로그 화면(주유/정비/하이패스) 공통 엑셀·PDF 버튼.
 * 세 화면이 동일하게 반복하던 버튼 마크업(SVG 아이콘·클래스)을 한 곳으로 모은다.
 * 다운로드 동작은 화면이 onExcel/onPdf 콜백으로 주입한다.
 */

interface LogExportButtonsProps {
    onExcel: () => void;
    onPdf: () => void;
    disabled?: boolean;
}

export default function LogExportButtons({ onExcel, onPdf, disabled = false }: LogExportButtonsProps) {
    return (
        <>
            <button
                onClick={onExcel}
                disabled={disabled}
                className="btn-secondary btn-sm flex items-center gap-2 disabled:opacity-50 min-h-[48px]"
            >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                엑셀
            </button>
            <button
                onClick={onPdf}
                disabled={disabled}
                className="btn-primary btn-sm flex items-center gap-2 disabled:opacity-50 min-h-[48px]"
            >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                </svg>
                PDF
            </button>
        </>
    );
}
