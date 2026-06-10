import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { FAQ_ITEMS } from '../../lib/faqData';
import useForceLightMode from '../../hooks/useForceLightMode';
import SEOHead from '../common/SEOHead';
import PublicNav from '../common/PublicNav';

/** #faqId 형태의 해시에서 인덱스를 추출 (0-based) */
function parseQHash(hash: string): number | null {
    if (!hash || !hash.startsWith('#')) return null;
    const id = hash.slice(1);
    const n = FAQ_ITEMS.findIndex(item => item.id === id);
    return n >= 0 ? n : null;
}

export default function FAQPage() {
    useForceLightMode();
    const location = useLocation();
    
    // 이전 해시를 추적하여 변경 시 컴포넌트 렌더 도중 상태 업데이트 (Cascading render 방지)
    const [prevHash, setPrevHash] = useState(location.hash);
    const [openIndex, setOpenIndex] = useState<number | null>(() => parseQHash(location.hash));
    const [highlightIndex, setHighlightIndex] = useState<number | null>(() => parseQHash(location.hash));
    const [search, setSearch] = useState('');
    const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
    const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

    if (location.hash !== prevHash) {
        setPrevHash(location.hash);
        const idx = parseQHash(location.hash);
        if (idx !== null) {
            setOpenIndex(idx);
            setHighlightIndex(idx);
        }
    }

    const toggle = (idx: number) => setOpenIndex(prev => (prev === idx ? null : idx));

    // URL 해시에 따른 스크롤 및 하이라이트 효과 처리
    useEffect(() => {
        const idx = parseQHash(location.hash);
        if (idx !== null) {
            // 약 2.5초간 하이라이트 지속 후 제거
            const highlightTimer = setTimeout(() => {
                setHighlightIndex(null);
            }, 2500);

            // DOM 렌더 이후 스크롤 및 버튼 포커스
            setTimeout(() => {
                const el = itemRefs.current[idx];
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    const btn = el.querySelector('button');
                    if (btn) {
                        // 스크롤은 수동 처리했으므로 preventScroll true 적용
                        btn.focus({ preventScroll: true });
                    }
                }
            }, 150);

            return () => clearTimeout(highlightTimer);
        }
    }, [location.hash]);

    // 링크 복사
    const copyLink = useCallback(async (idx: number, e: React.MouseEvent) => {
        e.stopPropagation();
        const item = FAQ_ITEMS[idx];
        const url = `${window.location.origin}/faq#${item.id}`;
        try {
            await navigator.clipboard.writeText(url);
            setCopiedIdx(idx);
            setTimeout(() => setCopiedIdx(null), 2000);
        } catch {
            // 클립보드 API 미지원 시 fallback
            const input = document.createElement('input');
            input.value = url;
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
            setCopiedIdx(idx);
            setTimeout(() => setCopiedIdx(null), 2000);
        }
    }, []);

    // FAQ JSON-LD 구조화 데이터 (구글 검색 결과에 Q&A 직접 노출)
    const faqJsonLd = useMemo(() => ({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: FAQ_ITEMS.map(item => ({
            '@type': 'Question',
            name: item.question,
            acceptedAnswer: {
                '@type': 'Answer',
                text: item.answer.join(' '),
            },
        })),
    }), []);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return FAQ_ITEMS.map((item, idx) => ({ item, idx }));
        return FAQ_ITEMS
            .map((item, idx) => ({ item, idx }))
            .filter(({ item }) =>
                item.question.toLowerCase().includes(q) ||
                item.answer.some(a => a.toLowerCase().includes(q)),
            );
    }, [search]);

    return (
        <div className="min-h-screen bg-gradient-to-br from-surface-50 to-primary-50 flex flex-col">
            <SEOHead
                title="자주 하는 질문"
                description="차량 운행일지 사용법, 예약, AI 계기판 인식 등 자주 묻는 질문과 답변입니다."
                path="/faq"
                jsonLd={faqJsonLd}
            />
            <PublicNav />
            <div className="flex-1 py-8 px-4">
            <div className="w-full max-w-2xl mx-auto animate-fade-in">
                <div className="bg-white dark:bg-surface-900 rounded-2xl shadow-soft p-6 md:p-8 space-y-6">
                    <div className="text-center border-b border-surface-100 dark:border-surface-700 pb-6">
                        <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-1">❓ 자주 하는 질문</h1>
                        <p className="text-sm text-surface-400 dark:text-surface-500">
                            평소에 궁금하셨던 점들을 모아두었어요.
                        </p>
                    </div>

                    {/* 검색 */}
                    <div className="relative">
                        <svg
                            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 dark:text-surface-500 pointer-events-none"
                            fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                        </svg>
                        <input
                            type="text"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="어떤 점이 궁금하신가요?"
                            className="w-full pl-10 pr-9 py-2.5 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 text-sm text-surface-800 dark:text-surface-200 placeholder:text-surface-400 dark:placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-300 transition-all min-h-[48px]"
                        />
                        {search && (
                            <button
                                onClick={() => { setSearch(''); setOpenIndex(null); }}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 dark:text-surface-500 hover:text-surface-600 dark:hover:text-surface-300 transition-colors min-h-[48px] min-w-[48px] flex items-center justify-center -mr-3"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                </svg>
                            </button>
                        )}
                    </div>

                    {/* 검색 결과 요약 */}
                    {search.trim() && (
                        <p className="text-xs text-surface-400 dark:text-surface-500 -mt-2">
                            {filtered.length > 0
                                ? `총 ${filtered.length}개의 질문을 찾았어요.`
                                : '앗, 일치하는 질문이 없네요. 다른 단어로 검색해 보시겠어요?'}
                        </p>
                    )}

                    {/* 아코디언 목록 */}
                    <div className="space-y-3">
                        {filtered.map(({ item, idx }) => {
                            const isOpen = openIndex === idx;
                            const isHighlighted = highlightIndex === idx;
                            const qId = item.id;

                            // isHighlighted일 때는 약간 튀어나오면서(Scale up) 진한 링과 배경 적용
                            const containerClasses = isHighlighted
                                ? 'border-primary-400 ring-4 ring-primary-300 ring-offset-2 bg-primary-50 scale-[1.02] shadow-xl relative z-10'
                                : isOpen
                                    ? 'border-primary-300 ring-2 ring-primary-100 bg-white relative z-0'
                                    : 'border-surface-200 hover:border-primary-300 bg-white relative z-0';

                            return (
                                <div
                                    key={idx}
                                    id={qId}
                                    ref={el => { itemRefs.current[idx] = el; }}
                                    className={`border rounded-xl overflow-hidden transition-all duration-700 ease-out origin-center ${containerClasses}`}
                                >
                                    <div
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => toggle(idx)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                toggle(idx);
                                            }
                                        }}
                                        className={`cursor-pointer w-full flex items-center gap-3 px-4 py-3.5 text-left outline-none focus-visible:bg-primary-50 transition-colors min-h-[48px] ${
                                            isHighlighted ? 'bg-transparent' : 'bg-surface-50 hover:bg-primary-50/50'
                                        }`}
                                    >
                                        <span className="flex-shrink-0 w-7 h-7 rounded-lg bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400 flex items-center justify-center text-xs font-bold">
                                            Q{idx + 1}
                                        </span>
                                        <span className="flex-1 text-sm font-semibold text-surface-800 dark:text-surface-200 leading-snug">
                                            {item.question}
                                        </span>
                                        {/* 링크 복사 버튼 */}
                                        <button
                                            onClick={(e) => copyLink(idx, e)}
                                            className="flex-shrink-0 w-12 h-12 -my-2 -ml-2 rounded-lg hover:bg-primary-100 dark:hover:bg-primary-900/40 flex items-center justify-center transition-colors group relative"
                                            title="이 질문 링크 복사"
                                        >
                                            {copiedIdx === idx ? (
                                                <svg className="w-3.5 h-3.5 text-green-500 dark:text-green-400" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                                                </svg>
                                            ) : (
                                                <svg className="w-3.5 h-3.5 text-surface-400 dark:text-surface-500 group-hover:text-primary-500 dark:group-hover:text-primary-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
                                                </svg>
                                            )}
                                        </button>
                                        <svg
                                            className={`w-4 h-4 text-surface-400 dark:text-surface-500 flex-shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                                            fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                                        >
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                                        </svg>
                                    </div>

                                    {/* 답변 영역 */}
                                    <div
                                        className="grid transition-all duration-200 ease-in-out"
                                        style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
                                    >
                                        <div className="overflow-hidden">
                                            <div className="px-4 pb-4 pt-2 space-y-1.5">
                                                {item.answer.map((line, lineIdx) => (
                                                    <p key={lineIdx} className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                                                        {line}
                                                    </p>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="border-t border-surface-100 dark:border-surface-700 pt-4 text-center">
                        <p className="text-xs text-surface-400 dark:text-surface-500">
                            여기에 없는 내용이 궁금하시다면 '더보기 → 건의하기'를 통해 편하게 물어보세요!
                        </p>
                    </div>
                </div>
            </div>
            </div>

            {/* 복사 완료 토스트 */}
            {copiedIdx !== null && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
                    <div className="bg-surface-800 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2">
                        <svg className="w-4 h-4 text-green-400 dark:text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                        </svg>
                        Q{copiedIdx + 1} 링크가 복사되었어요!
                    </div>
                </div>
            )}
        </div>
    );
}
