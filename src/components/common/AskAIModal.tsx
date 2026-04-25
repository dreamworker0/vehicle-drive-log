/**
 * AskAIModal — 🤖 AI에게 물어보기 모달
 *
 * FAQ + 사용 설명서 기반으로 Gemini가 답변하는 간단한 질의응답 UI
 */
import React, { useState, useRef, useEffect } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useNavigate } from 'react-router-dom';
import { FAQ_ITEMS } from '../../lib/faqData';

interface AskAIModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface ChatMessage {
    role: 'user' | 'ai';
    text: string;
}

const AskAIModal: React.FC<AskAIModalProps> = ({ isOpen, onClose }) => {
    const [question, setQuestion] = useState('');
    const [loading, setLoading] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [error, setError] = useState('');
    const chatEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const navigate = useNavigate();

    const renderMessageText = (text: string) => {
        // FAQ 토큰 뒤의 불필요한 줄바꿈만 제거 (앞 줄바꿈은 유지하여 링크가 별도 줄에 표시)
        const cleaned = text
            .replace(/(FAQ\[[a-zA-Z0-9-]+\])\n+/g, '$1 ');

        // 정규식을 캡처 그룹으로 묶어서 split에 활용 (매칭 문자열도 배열에 포함됨)
        const splitRegex = /(FAQ\[[a-zA-Z0-9-]+\])/g;
        const extractIdRegex = /FAQ\[([a-zA-Z0-9-]+)\]/;

        if (!splitRegex.test(cleaned)) {
            // 하위 호환성 (id 없는 경우)
            const oldTarget = '자세한 내용은 FAQ를 참고해주세요.';
            if (!cleaned.includes(oldTarget)) {
                // 일반 줄바꿈 처리
                return cleaned.split('\n').map((line, i, arr) => (
                    <React.Fragment key={i}>{line}{i < arr.length - 1 && <br />}</React.Fragment>
                ));
            }
            
            const parts = cleaned.split(oldTarget);
            return (
                <>
                    {parts.map((part, index) => (
                        <React.Fragment key={index}>
                            {part}
                            {index < parts.length - 1 && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        onClose();
                                        navigate('/faq');
                                    }}
                                    className="text-primary-600 dark:text-primary-400 underline decoration-primary-500/30 underline-offset-4 hover:text-primary-700 dark:hover:text-primary-300 font-semibold"
                                >
                                    {oldTarget}
                                </button>
                            )}
                        </React.Fragment>
                    ))}
                </>
            );
        }

        const parts = cleaned.split(splitRegex);
        
        return (
            <>
                {parts.map((part, index) => {
                    const match = part.match(extractIdRegex);
                    if (match) {
                        const id = match[1];
                        const faqItem = FAQ_ITEMS.find((item) => item.id === id);
                        const buttonLabel = faqItem ? `[FAQ: ${faqItem.question}]` : `[FAQ 보러가기]`;
                        return (
                            <button
                                key={index}
                                type="button"
                                onClick={() => {
                                    onClose();
                                    navigate(`/faq#${id}`);
                                }}
                                className="inline text-primary-600 dark:text-primary-400 underline decoration-primary-500/30 underline-offset-4 hover:text-primary-700 dark:hover:text-primary-300 font-semibold"
                            >
                                {buttonLabel}
                            </button>
                        );
                    }
                    // 일반 텍스트 내 줄바꿈 처리
                    return (
                        <React.Fragment key={index}>
                            {part.split('\n').map((line, i, arr) => (
                                <React.Fragment key={i}>{line}{i < arr.length - 1 && <br />}</React.Fragment>
                            ))}
                        </React.Fragment>
                    );
                })}
            </>
        );
    };

    useEffect(() => {
        if (isOpen) {
            if (textareaRef.current) {
                setTimeout(() => textareaRef.current?.focus(), 200);
            }
        } else {
             
            setQuestion('');
            setMessages([]);
            setError('');
            setLoading(false);
             
        }
    }, [isOpen]);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = question.trim();
        if (!trimmed || loading) return;

        setError('');
        setMessages(prev => [...prev, { role: 'user', text: trimmed }]);
        setQuestion('');
        setLoading(true);

        try {
            const functions = getFunctions(undefined, 'asia-northeast3');
            const askAI = httpsCallable<{ question: string }, { answer: string }>(functions, 'askAI', { timeout: 30000 });
            const result = await askAI({ question: trimmed });
            setMessages(prev => [...prev, { role: 'ai', text: result.data.answer }]);
        } catch (err: unknown) {
            const error = err as { code?: string; message?: string };
            if (error.code === 'functions/resource-exhausted') {
                setError('질문이 너무 많습니다. 잠시 후 다시 시도해주세요.');
            } else {
                setError('답변을 가져오지 못했습니다. 다시 시도해주세요.');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
             onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="w-full max-w-lg bg-white dark:bg-surface-800 rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col"
                 style={{ maxHeight: '85vh' }}>

                {/* 헤더 */}
                <div className="flex items-center justify-between p-4 border-b border-surface-100 dark:border-surface-700">
                    <div className="flex items-center gap-2">
                        <span className="text-xl">🤖</span>
                        <h2 className="text-lg font-bold text-surface-900 dark:text-surface-100">AI에게 물어보기</h2>
                    </div>
                    <button onClick={onClose} className="btn-icon text-surface-400 hover:text-surface-600 dark:text-surface-400">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* 채팅 영역 */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ minHeight: '200px', maxHeight: '50vh' }}>
                    {messages.length === 0 && !loading && (
                        <div className="text-center py-8 space-y-3">
                            <div className="text-4xl">💬</div>
                            <p className="text-sm text-surface-500 dark:text-surface-400">
                                앱 사용 방법이나 기능에 대해 물어보세요!
                            </p>
                            <div className="flex flex-wrap justify-center gap-2">
                                {['예약은 어떻게 하나요?', '운행기록 수정은 어떻게 하나요?', '다크 모드 설정'].map(q => (
                                    <button
                                        key={q}
                                        onClick={() => setQuestion(q)}
                                        className="text-xs px-3 py-1.5 rounded-full bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-800/40 transition-colors"
                                    >
                                        {q}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {messages.map((msg, i) => (
                        <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                                msg.role === 'user'
                                    ? 'bg-primary-500 text-white rounded-br-md'
                                    : 'bg-surface-100 dark:bg-surface-700 text-surface-800 dark:text-surface-200 rounded-bl-md'
                            }`}>
                                {msg.role === 'ai' && <span className="mr-1">🤖</span>}
                                {msg.role === 'ai' ? renderMessageText(msg.text) : msg.text}
                            </div>
                        </div>
                    ))}

                    {loading && (
                        <div className="flex justify-start">
                            <div className="bg-surface-100 dark:bg-surface-700 rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-2">
                                <span className="w-4 h-4 spinner" />
                                <span className="text-sm text-surface-500 dark:text-surface-400">생각하는 중...</span>
                            </div>
                        </div>
                    )}

                    {error && (
                        <div className="text-center text-xs text-red-500 dark:text-red-400 py-1">
                            {error}
                        </div>
                    )}

                    <div ref={chatEndRef} />
                </div>

                {/* 입력 영역 */}
                <form onSubmit={handleSubmit} className="p-3 border-t border-surface-100 dark:border-surface-700">
                    <div className="flex items-end gap-2">
                        <textarea
                            ref={textareaRef}
                            value={question}
                            onChange={(e) => setQuestion(e.target.value.slice(0, 500))}
                            onKeyDown={handleKeyDown}
                            placeholder="질문을 입력하세요..."
                            rows={1}
                            className="flex-1 resize-none rounded-xl border border-surface-200 dark:border-surface-600 bg-surface-50 dark:bg-surface-900 text-surface-900 dark:text-surface-100 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 dark:focus:ring-primary-500"
                            disabled={loading}
                        />
                        <button
                            type="submit"
                            disabled={!question.trim() || loading}
                            className="shrink-0 w-10 h-10 rounded-xl bg-primary-500 text-white flex items-center justify-center disabled:opacity-40 hover:bg-primary-600 transition-colors"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                            </svg>
                        </button>
                    </div>
                    <p className="text-[10px] text-surface-400 mt-1.5 text-center">
                        AI 답변은 FAQ와 설명서를 기반으로 합니다 · {question.length}/500
                    </p>
                </form>
            </div>
        </div>
    );
};

export default AskAIModal;
