import { useState, useRef, useEffect } from 'react';

interface Org {
    id: string;
    name: string;
}

interface OrgSearchDropdownProps {
    selectedOrgId: string;
    onChange: (orgId: string) => void;
    orgs: Org[];
}

export default function OrgSearchDropdown({ selectedOrgId, onChange, orgs }: OrgSearchDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const wrapperRef = useRef<HTMLDivElement>(null);

    // 전체 기관과 정렬된 기관 목록 합치기
    const sortedOrgs = [...orgs].sort((a, b) => a.name.localeCompare(b.name));
    const allOption = { id: 'ALL', name: '전체 기관 통계' };
    const options = [allOption, ...sortedOrgs];

    // 검색어로 필터링
    const filteredOptions = options.filter(org => 
        org.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // 현재 선택된 기관 찾기
    const selectedOrg = options.find(org => org.id === selectedOrgId) || allOption;

    // 바깥쪽 클릭 시 닫기
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                setSearchTerm(''); // 닫힐 때 검색어 초기화
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSelect = (orgId: string) => {
        onChange(orgId);
        setIsOpen(false);
        setSearchTerm('');
    };

    return (
        <div ref={wrapperRef} className="relative w-full sm:w-64">
            <div
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIsOpen(!isOpen); } }}
                className="flex items-center justify-between p-1.5 px-3 text-sm font-medium rounded-lg border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 cursor-pointer hover:border-primary-500 focus-within:ring-2 focus-within:ring-primary-500 transition-colors"
                onClick={() => setIsOpen(!isOpen)}
            >
                {/* 열려있을 때는 검색창, 닫혀있을 때는 선택된 값 표시 */}
                {isOpen ? (
                    <input
                        type="text"
                        className="w-full bg-transparent outline-none min-h-[48px]"
                        placeholder="기관명 검색..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        onClick={(e) => e.stopPropagation()} // input 클릭 시 닫히지 않도록
                    />
                ) : (
                    <span className="truncate">{selectedOrg.name}</span>
                )}
                <svg 
                    className={`w-4 h-4 ml-2 text-surface-500 dark:text-surface-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} 
                    fill="none" 
                    viewBox="0 0 24 24" 
                    stroke="currentColor"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </div>

            {/* 드롭다운 목록 */}
            {isOpen && (
                <div className="absolute z-50 w-full mt-1 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg shadow-lg max-h-60 overflow-y-auto hide-scrollbar">
                    {filteredOptions.length > 0 ? (
                        <ul className="py-1">
                            {filteredOptions.map((org) => (
                                <li
                                    key={org.id}
                                    role="option"
                                    aria-selected={org.id === selectedOrgId}
                                    tabIndex={0}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelect(org.id); } }}
                                    className={`px-3 py-2 text-sm cursor-pointer transition-colors
                                        ${org.id === selectedOrgId 
                                            ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 font-medium' 
                                            : 'text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700'
                                        }`}
                                    onClick={() => handleSelect(org.id)}
                                >
                                    {org.name}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <div className="px-3 py-3 text-sm text-center text-surface-500 dark:text-surface-400">
                            검색 결과가 없습니다.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
