import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { FAQ_ITEMS } from '../../lib/faqData';
import useForceLightMode from '../../hooks/useForceLightMode';
import SEOHead from '../common/SEOHead';

export default function FAQPage() {
    useForceLightMode();
    const navigate = useNavigate();
    const [openIndex, setOpenIndex] = useState<number | null>(null);
    const [search, setSearch] = useState('');

    const toggle = (idx: number) => setOpenIndex(prev => (prev === idx ? null : idx));

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
        <div className="min-h-screen bg-gradient-to-br from-surface-50 to-primary-50 py-8 px-4">
            <SEOHead
                title="자주 하는 질문"
                description="차량 운행일지 사용법, 예약, AI 계기판 인식 등 자주 묻는 질문과 답변입니다."
                path="/faq"
                jsonLd={faqJsonLd}
            />
            <div className="w-full max-w-2xl mx-auto animate-fade-in">
                {/* 뒤로가기 */}
                <button
                    onClick={() => navigate(-1)}
                    className="flex items-center gap-1.5 text-sm text-surface-500 hover:text-surface-700 mb-6 transition-colors"
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                    </svg>
                    돌아가기
                </button>

                <div className="bg-white rounded-2xl shadow-soft p-6 md:p-8 space-y-6">
                    <div className="text-center border-b border-surface-100 pb-6">
                        <h1 className="text-2xl font-bold text-surface-900 mb-1">❓ 자주 하는 질문</h1>
                        <p className="text-sm text-surface-400">
                            궁금한 점을 빠르게 확인하세요.
                        </p>
                    </div>

                    {/* 검색 */}
                    <div className="relative">
                        <svg
                            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 pointer-events-none"
                            fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                        </svg>
                        <input
                            type="text"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="질문 검색..."
                            className="w-full pl-10 pr-9 py-2.5 rounded-xl border border-surface-200 bg-surface-50 text-sm text-surface-800 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-300 transition-all"
                        />
                        {search && (
                            <button
                                onClick={() => { setSearch(''); setOpenIndex(null); }}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-600 transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                </svg>
                            </button>
                        )}
                    </div>

                    {/* 검색 결과 요약 */}
                    {search.trim() && (
                        <p className="text-xs text-surface-400 -mt-2">
                            {filtered.length > 0
                                ? `${filtered.length}개의 결과가 있습니다.`
                                : '검색 결과가 없습니다. 다른 키워드로 검색해 보세요.'}
                        </p>
                    )}

                    {/* 아코디언 목록 */}
                    <div className="space-y-3">
                        {filtered.map(({ item, idx }) => {
                            const isOpen = openIndex === idx;
                            return (
                                <div
                                    key={idx}
                                    className="border border-surface-200 rounded-xl overflow-hidden transition-colors hover:border-primary-300"
                                >
                                    <button
                                        onClick={() => toggle(idx)}
                                        className="w-full flex items-center gap-3 px-4 py-3.5 text-left bg-surface-50 hover:bg-primary-50/50 transition-colors"
                                    >
                                        <span className="flex-shrink-0 w-7 h-7 rounded-lg bg-primary-100 text-primary-600 flex items-center justify-center text-xs font-bold">
                                            Q{idx + 1}
                                        </span>
                                        <span className="flex-1 text-sm font-semibold text-surface-800 leading-snug">
                                            {item.question}
                                        </span>
                                        <svg
                                            className={`w-4 h-4 text-surface-400 flex-shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                                            fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                                        >
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                                        </svg>
                                    </button>

                                    {/* 답변 영역 */}
                                    <div
                                        className="grid transition-all duration-200 ease-in-out"
                                        style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
                                    >
                                        <div className="overflow-hidden">
                                            <div className="px-4 pb-4 pt-2 space-y-1.5">
                                                {item.answer.map((line, lineIdx) => (
                                                    <p key={lineIdx} className="text-sm text-surface-600 leading-relaxed">
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

                    <div className="border-t border-surface-100 pt-4 text-center">
                        <p className="text-xs text-surface-400">
                            더 궁금한 점이 있으시면 더보기 → 의견 보내기를 이용해주세요.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
