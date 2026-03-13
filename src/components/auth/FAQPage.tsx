import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FAQ_ITEMS } from '../../lib/faqData';
import useForceLightMode from '../../hooks/useForceLightMode';

export default function FAQPage() {
    useForceLightMode();
    const navigate = useNavigate();
    const [openIndex, setOpenIndex] = useState<number | null>(null);

    const toggle = (idx: number) => setOpenIndex(prev => (prev === idx ? null : idx));

    return (
        <div className="min-h-screen bg-gradient-to-br from-surface-50 to-primary-50 py-8 px-4">
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

                    {/* 아코디언 목록 */}
                    <div className="space-y-3">
                        {FAQ_ITEMS.map((item, idx) => {
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
